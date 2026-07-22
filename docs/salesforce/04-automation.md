# 04 — Inventario delle automazioni

> Fonti: scansione completa di `force-app/main/default/` (flows, workflows, triggers, validation rules), sorgenti Apex/LWC.

## 1. Automazione dichiarativa: assente per scelta

Il repository **non contiene** alcuna automazione dichiarativa o trigger:

| Tipo                                                     | Presenza                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Flow (record-triggered, screen, autolaunched, scheduled) | Nessuno                                                                                                                     |
| Process Builder / Workflow Rule (legacy)                 | Nessuno                                                                                                                     |
| Apex Trigger                                             | Nessuno                                                                                                                     |
| Validation Rule                                          | **6** — formato hex (`#RRGGBB`) dei sei campi colore di `Survey_Theme__c` (introdotte con R13); nessuna sugli altri oggetti |
| Approval Process                                         | Nessuno                                                                                                                     |
| Assignment/Escalation/Auto-response Rule                 | Nessuna                                                                                                                     |

Non c'è quindi alcun rischio di automazioni sovrapposte sullo stesso oggetto, né debito legacy Workflow/Process Builder.

## 2. Dove vive la "logica di processo"

Tutta la logica è concentrata in **Apex invocato dai LWC** (dettaglio completo in [05-apex-components.md](05-apex-components.md)):

| Regola di business                                      | Dove è implementata                                                                      | Quando scatta                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Solo survey `Active` compilabili                        | `SurveyService.loadActiveSurveyByName`                                                   | Al caricamento del runner                            |
| Survey Active deve avere `Start_Question__c`            | `SurveyService.loadActiveSurveyByName`                                                   | Al caricamento del runner                            |
| Limite 500 domande per survey (`MAX_GRAPH_NODES`)       | `SurveyService.buildSurveyDTO`                                                           | A ogni load del grafo                                |
| Domanda required → risposta obbligatoria                | LWC `surveyRunner.validateAnswer` (UX) **e** `SurveyService.buildAnswerRecords` (server) | Navigazione/submission                               |
| Validazione regex risposte aperte e "Altro: ___"        | Solo LWC `surveyRunner.validateAnswer`                                                   | Navigazione/submission                               |
| Navigazione condizionale del grafo                      | LWC `surveyRunner.computeNextQuestionId`                                                 | A ogni "Avanti"                                      |
| Snapshot testi/nome/versione alla scrittura             | `SurveyService.newAnswerRecord` / `buildAnswerRecords`                                   | Alla submission                                      |
| Multi-choice → un record per opzione                    | `SurveyService.buildAnswerRecords`                                                       | Alla submission                                      |
| Popolamento lookup dinamici da JSON con validazioni     | `SurveyService.applyEntityMapping`                                                       | Alla submission                                      |
| `Completed_Date__c` e `Submitted_By__c`                 | `SurveyService.submitResponse`                                                           | Alla submission                                      |
| Transazione atomica con rollback                        | `SurveyService.submitResponse` (savepoint)                                               | Alla submission                                      |
| Divieto di cicli nel grafo, nodi orfani, start mancante | `SurveyService.validateGraph` (DFS + reachability)                                       | **Solo su richiesta** (bottone "Valida" nell'editor) |

## 3. Osservazioni fattuali

1. **Le regole valgono solo passando dai componenti.** Nessuna validation rule o trigger presidia gli oggetti: dati caricati via API/data loader (o modifiche manuali ai record) possono violare tutte le regole della tabella sopra (es. Question_Response senza snapshot, survey Active senza start question, cicli nel grafo).
2. **La validazione del grafo non è bloccante.** `validateGraph` viene eseguita solo se l'author preme "Valida" nell'editor; non esiste un enforcement al salvataggio né al passaggio di `Status__c` a `Active`. Un grafo con cicli può quindi andare in produzione; il runner non ha protezione esplicita anti-loop a runtime (la navigazione seguirebbe il ciclo indefinitamente, pur senza bloccare il browser, dato che serve l'interazione dell'utente a ogni passo).
3. **La validazione regex è solo client-side.** `SurveyService.submitResponse` non riesegue le regex sul server: una submission costruita ad arte (o un bug del client) può salvare valori che non rispettano `Validation_Regex__c`.
4. **Doppia compilazione non prevenuta.** Nessun vincolo (né codice né dichiarativo) impedisce a uno stesso utente di inviare più `Survey_Response__c` per lo stesso survey/entità — punto lasciato aperto anche nel design (§8).

**Decisioni prese:**

- **Enforcement alla pubblicazione**: l'esigenza è considerata **già coperta** dai meccanismi esistenti (bottone "Valida" nell'editor + eccezione runtime in `loadActiveSurveyByName` che impedisce comunque la compilazione di un survey Active senza start question). Nota: nel repo non esiste un blocco _automatico_ al passaggio a `Active`; l'unico rafforzamento deciso è la validation rule su `Start_Question__c` censita in [07-roadmap.md](07-roadmap.md) — se in discussione si volesse estendere il blocco anche a cicli/orfani, va aggiunto lì.
- **Protezione anti-doppia-compilazione**: da implementare, inserita in [07-roadmap.md](07-roadmap.md); il criterio di unicità (utente+survey, entità+survey, ...) è una delle decisioni da prendere in quella sede.
