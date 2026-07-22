# 05 — Apex, Lightning Web Components e UI

> Fonti: `classes/*.cls`, `lwc/**`, `applications/`, `flexipages/`, `tabs/`, `layouts/`.

## 1. Architettura del codice

```
LWC surveyRunner (compilazione)          LWC surveyAuthor (editor a grafo)
        │  @salesforce/apex                      │ @wire getSurveyById / validateGraph
        ▼                                        │ + lightning/uiRecordApi (CRUD diretto)
SurveyController  ──────────────────────────────►│   + exportResponsesCsv (bottone "Esporta risposte")
  (facade @AuraEnabled, with sharing)            │
        ▼                                        ▼
SurveyService (business logic, with sharing, WITH SECURITY_ENFORCED)  ◄── SurveyExportController
        ▼                                                                 (facade @AuraEnabled, admin-only)
Survey__c / Question__c / Answer_Option__c / Survey_Response__c / Question_Response__c
```

Pattern **Controller sottile + Service**: `SurveyController` si limita a delegare, convertire JSON e rilanciare ogni eccezione come `AuraHandledException` (l'unico tipo che porta un messaggio pulito al LWC). Tutta la logica è in `SurveyService`. L'editor, per le **scritture**, non passa da Apex ma da `lightning/uiRecordApi`, così CRUD/FLS/sharing sono applicati nativamente dalla piattaforma. **`SurveyExportController` è un secondo, piccolo controller** (non un metodo su `SurveyController`) creato apposta per l'export delle risposte: l'accesso Apex si concede per classe intera, non per singolo metodo, e `Survey_Respondent` ha già accesso a `SurveyController` — tenerlo separato è l'unico modo di garantire che l'export resti riservato a `Survey_Admin` (vedi §2b e [03-security-sharing.md](03-security-sharing.md)).

## 2. SurveyController (API 66.0, `with sharing`)

| Metodo              | Firma                                        | Cacheable | Uso                                                                                                                                                      |
| ------------------- | -------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSurveyByName`   | `(String surveyName) → SurveyDTO`            | Sì        | Load del runner: solo survey `Active`.                                                                                                                   |
| `getSurveyById`     | `(Id surveyId) → SurveyDTO`                  | Sì        | Load dell'editor a grafo, dell'editor experience e dell'anteprima (qualsiasi status, anche Draft).                                                       |
| `submitResponse`    | `(String submissionJson) → SubmissionResult` | No        | Submission: deserializza il JSON in `SubmissionRequest` e delega.                                                                                        |
| `validateGraph`     | `(Id surveyId) → GraphValidationResult`      | No        | Bottone "Valida" dell'editor a grafo.                                                                                                                    |
| `registerThemeLogo` | `(Id themeId, Id contentDocumentId) → void`  | No        | Hook post-upload dell'editor experience (R13): rende il File del logo visibile a tutti gli utenti interni (`ContentDocumentLink.Visibility = AllUsers`). |

(Il metodo legacy `getThemeJson` — lettura dei temi JSON da static resource — è stato rimosso con la dismissione del vecchio theming.)

## 2b. SurveyExportController (API 66.0, `with sharing`) — admin-only

Unico metodo: `exportResponsesCsv(Id surveyId) → String`, wrapper try/catch → `AuraHandledException` attorno a `SurveyService.exportResponsesCsv`, stesso pattern di `SurveyController`. Concesso via Apex class access **solo** al permission set `Survey_Admin` (non a `Survey_Respondent`) — vedi §3 sotto per la logica e [03-security-sharing.md](03-security-sharing.md) per il ragionamento sui permessi.

## 3. SurveyService (API 66.0, `with sharing`)

Costanti (`@TestVisible`): `MAX_GRAPH_NODES = 500` — un survey con ≥500 domande viene rifiutato al load con l'indicazione di dividerlo; `MAX_EXPORT_RESPONSES = 5000` e `MAX_EXPORT_ANSWER_ROWS = 40000` — governor dell'export CSV (vedi sotto).

### DTO esposti al LWC (tutti con campi `@AuraEnabled`)

- `SurveyDTO` (id, name, description, status, version, startQuestionId, `List<QuestionDTO>`; da R13 anche i **testi di cornice** displayTitle/introText/closingMessage/nextLabel/backLabel/submitLabel e il **`ThemeDTO theme`**, `null` se il survey non ha `Theme__c`)
- `ThemeDTO` (id, name, i 6 colori, borderRadius, fontFamily, showProgressBar, `logoUrl` — URL di download della ContentVersion più recente collegata al tema —, `logoHeight` — altezza di rendering in px del logo, larghezza automatica — e `usageCount`, il numero di survey che usano il tema, mostrato come avviso nell'editor experience)
- `QuestionDTO` (testo, tipo, required, orderHint, regex+messaggio, placeholder, defaultNextQuestionId, editorX/Y, `List<OptionDTO>`)
- `OptionDTO` (testo, orderHint, nextQuestionId, allowsFreeText, freeTextRegex+messaggio)
- `SubmissionRequest` (surveyId, entityMappingJson, `List<AnswerInput>`), `AnswerInput` (questionId, selectedOptionIds, freeTextValue)
- `SubmissionResult` (surveyResponseId, questionResponsesCreated), `GraphValidationResult` (isValid, errors, cycles)
- `SurveyException` (custom exception unica del modulo)

### Caricamento (`loadActiveSurveyByName`, `loadSurveyById`, `buildSurveyDTO`)

- `loadActiveSurveyByName`: cerca per `Name` esatto, pretende `Status__c = 'Active'` e `Start_Question__c` valorizzato; altrimenti `SurveyException` con messaggio parlante.
- `loadSurveyById`: nessun vincolo di status (serve all'editor per lavorare sui Draft).
- `buildSurveyDTO`: 2 SOQL (domande ordinate per `Order__c NULLS LAST, CreatedDate`; opzioni delle domande con stesso ordinamento), raggruppa le opzioni per domanda e materializza il DTO. Nessuna query in loop.
- **Tema (R13)** — `buildThemeDTO` mappa i campi `Theme__r.*` (già inclusi nella SOQL del survey), `latestLogoUrl` risolve il logo come File più recente collegato al tema (`ContentDocumentLink` → `/sfc/servlet.shepherd/version/download/{versionId}`) e un `COUNT()` su `Survey__c` calcola `usageCount`. `registerThemeLogo(themeId, contentDocumentId)` imposta `Visibility = AllUsers` sul link del File appena caricato (errore se il File non è collegato al tema).

### Submission (`submitResponse`)

1. Valida input (surveyId e answers obbligatori).
2. **Ricarica il grafo dal DB** — così gli snapshot fotografano il testo _corrente_ al momento della scrittura, non quello che il client aveva in memoria.
3. Costruisce `Survey_Response__c` con `Completed_Date__c = System.now()` e `Submitted_By__c = UserInfo.getUserId()`, poi applica il mapping dinamico (vedi sotto).
4. Per ogni `AnswerInput` costruisce i `Question_Response__c` (`buildAnswerRecords`):
   - **con opzioni selezionate** → un record per opzione (regola multi-choice), con `Selected_Option__c`, `Answer_Text_Snapshot__c` = testo opzione, e `Free_Text_Value__c` replicato su ogni opzione che ha `allowsFreeText` (il client mantiene un solo testo libero per domanda);
   - **solo testo libero** → un record con `Free_Text_Value__c` e `Answer_Text_Snapshot__c` = testo digitato;
   - **nessuna risposta** → eccezione se la domanda è required, altrimenti record "vuoto" (traccia che la domanda è stata vista);
   - ogni record porta gli snapshot comuni (`Question_Text_Snapshot__c`, `Survey_Name_Snapshot__c`, `Survey_Version_Snapshot__c`) via `newAnswerRecord`.
   - Riferimenti a domande/opzioni sconosciute → eccezione (protezione da payload incoerenti).
5. **Transazione atomica**: `Database.setSavepoint()`, insert della sessione, aggancio del master-detail sui figli, insert dei figli; su qualunque errore `Database.rollback` + `SurveyException`. Due DML totali, nessun record orfano.

### Mapping dinamico entità (`applyEntityMapping`, `@TestVisible`)

Deserializza il JSON `{campo → recordId}`; per ogni chiave verifica in Describe che: il campo esista su `Survey_Response__c` (lookup case-insensitive), sia di tipo `REFERENCE`, il valore sia un Id valido e il **key prefix** dell'Id coincida con quello dell'oggetto target del lookup. Ogni violazione → `SurveyException` con messaggio specifico. Chiavi con valore `null` vengono ignorate.

### Validazione del grafo (`validateGraph`, `dfsCycle`)

- Costruisce la lista di adiacenza da opzioni (`nextQuestionId`) + `defaultNextQuestionId`.
- **Cicli**: DFS con colorazione white/gray/black avviata da ogni nodo (così controlla anche i sotto-grafi disconnessi); riporta il primo ciclo trovato per nodo di partenza come lista di Id (ri-includendo il nodo di chiusura). Archi verso nodi fuori dal survey vengono ignorati per difesa.
- **Orfani**: reachability iterativa dal nodo di start; ogni domanda non raggiungibile genera un errore.
- Start mancante → errore. `isValid = false` se c'è almeno un problema.

### Export CSV pivotato (`exportResponsesCsv`) — bottone "Esporta risposte" in Survey Author

Genera un **CSV in memoria** (nessun File creato, nessuna chiamata esterna): una riga per `Survey_Response__c` (rispondente), una colonna per `Question__c` del survey, restituito come `String` all'LWC che lo scarica via `Blob` nel browser.

1. Verifica esistenza del survey (`SurveyException` altrimenti) e carica le domande ordinate (stesso ordinamento `Order__c NULLS LAST, CreatedDate ASC` usato altrove), con lo stesso guardrail `MAX_GRAPH_NODES` del load.
2. **Governor di sicurezza** (query `COUNT()`, economiche): se il numero di `Survey_Response__c` supera `MAX_EXPORT_RESPONSES` (5000) o il numero totale di righe `Question_Response__c` del survey supera `MAX_EXPORT_ANSWER_ROWS` (40.000), l'export si rifiuta con un errore esplicito **prima** di fare lavoro pesante — protezione contro il limite di 50.000 righe SOQL per transazione, che altrimenti un survey con molte domande _e_ molte risposte potrebbe superare silenziosamente (500 domande × 5000 risposte = 2,5M righe teoriche).
3. Carica le risposte (`Survey_Response__c`, ordinate per `Completed_Date__c ASC NULLS LAST`) e tutte le `Question_Response__c` collegate in un'unica query, raggruppate in memoria per `(Survey_Response__c, Question__c)` — necessario perché le domande multi-choice hanno più righe per la stessa coppia (una per opzione selezionata).
4. **Contenuto di ogni cella** (`formatAnswerCell`): usa sempre `Answer_Text_Snapshot__c` (mai il testo live dell'opzione — coerente con la filosofia di snapshot del resto del modello); per un'opzione con `Allows_Free_Text__c` e testo libero compilato, appende `(testo libero)`; per multi-choice, concatena le risposte con `; ` (ordine deterministico: query ordinata per `CreatedDate ASC, Id ASC`).
5. **Escaping CSV**: ogni cella è sempre racchiusa tra virgolette doppie con le virgolette interne raddoppiate (RFC 4180-ish) — semplice e sempre sicuro, indipendentemente dal contenuto (virgole, virgolette, testi multilinea nelle domande a testo lungo).
6. Righe separate da `\r\n` per compatibilità Excel; nessuna colonna per i lookup di entità dinamici (`Account__c`, `Contact__c`, ecc.) in questa prima versione — limite noto, non richiesto nella prima implementazione.

## 4. SurveyServiceTest (37 metodi di test)

Seed condiviso `seedLinearSurvey(status)`: survey con 3 domande (Q1 SingleChoice required con 2 opzioni, Q2 FreeText con regex `^\d{2}$`, Q3 terminale), opzione A → Q2, opzione B terminale, Q2 → Q3 via default next.

Copertura per area:

| Area               | Test                                                                                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load               | grafo completo restituito; survey non-Active → errore; start mancante → errore; nome blank → errore                                                                                                                                                                          |
| Submission         | snapshot corretti e sessione popolata (data, utente); multi-choice → 2 record; required senza risposta → errore; questionId sconosciuto → errore                                                                                                                             |
| Entity mapping     | popolamento `Account__c`; campo inesistente → errore; Id di tipo sbagliato (Contact su lookup Account) → errore; campo non-lookup → errore                                                                                                                                   |
| Graph validation   | grafo pulito valido; ciclo rilevato; orfano rilevato                                                                                                                                                                                                                         |
| Tema & testi (R13) | DTO popolato (colori, radius, flag, testi, usageCount); survey senza tema → `theme` null; usageCount con tema condiviso tra 2 survey; logo registrato (`Visibility = AllUsers`) ed esposto come URL shepherd; registrazione logo con File non collegato → errore             |
| Export CSV         | pivot single-choice + free text (header e celle attese); multi-choice concatenato con `; `; companion free-text tra parentesi; nessuna risposta → solo header; `surveyId` null → errore; survey inesistente → errore; escaping di virgole/virgolette nel testo della domanda |
| Controller (smoke) | `getSurveyByName`, `getSurveyById` (Draft), `submitResponse` (payload JSON reale), `validateGraph`, `registerThemeLogo`, `SurveyExportController.exportResponsesCsv` + percorsi di errore `AuraHandledException`                                                             |

Ultimo deploy in org (2026-07-21, ToolSurvey): 37/37 test passati. Assenza nota: **nessun test Jest per i LWC** (toolchain configurata ma cartelle `__tests__` assenti — roadmap R10).

## 5. LWC `surveyRunner` — compilazione (esposto: App/Record/Home Page, Flow Screen; componibile in altri LWC)

### 5.1 Proprietà di input

| Proprietà            | Tipo    | Significato                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surveyName`         | String  | `Name` del record `Survey__c` da erogare; deve essere Active.                                                                                                                                                                                                                                                                          |
| `entityMapping`      | String  | JSON manuale/avanzato `{campo lookup su Survey_Response__c → recordId}`. In alternativa (o in aggiunta) a `entityMappingField` — vedi sotto.                                                                                                                                                                                           |
| `entityMappingField` | String  | API name del campo lookup su `Survey_Response__c` da collegare automaticamente a `recordId` (es. `Account__c`).                                                                                                                                                                                                                        |
| `recordId`           | String  | **Su Record Page**: popolata automaticamente da Lightning App Builder (proprietà `@api recordId` con nome riservato — comportamento standard della piattaforma, non compare nel pannello proprietà, nessun merge field da digitare). **In un Flow o in un altro LWC**: nessuna auto-injection — va bindata esplicitamente (vedi §5.4). |
| `surveyId`           | Id      | (R13/R5) Caricamento per Id, **qualsiasi status**: usato dall'anteprima dell'editor experience. Ha precedenza su `surveyName`.                                                                                                                                                                                                         |
| `previewMode`        | Boolean | (R13/R5) Modalità anteprima: banner "le risposte non vengono salvate", submission **senza DML** (mostra solo la schermata di chiusura). Non esposta come proprietà configurabile né su App Builder né su Flow: è pensata solo per uso programmatico (dall'editor experience), per evitare che resti attivata per errore in produzione. |

**Costruzione del mapping entità (`buildEntityMappingJson`)**: se `recordId` **e** `entityMappingField` sono entrambi valorizzati, il componente li fonde con l'eventuale `entityMapping` manuale — `{ ...JSON.parse(entityMapping), [entityMappingField]: recordId }` — così si può usare la scorciatoia automatica e, se serve, aggiungere altri lookup a mano nello stesso JSON. Se `entityMapping` è presente ma malformato, viene passato tal quale ad Apex (che solleva il consueto errore "Invalid entity-mapping JSON") invece di essere scartato silenziosamente. Senza `recordId`/`entityMappingField` il comportamento è quello di sempre: solo `entityMapping`, se presente.

### 5.2 Output ed eventi (integrazione con Flow e con altri LWC)

| Nome               | Tipo          | Dove                      | Significato                                                                                                                                                                                                                                                         |
| ------------------ | ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCompleted`      | Boolean       | `@api` getter (read-only) | `true` dopo la submission (o dopo la chiusura in `previewMode`). In Flow è un output leggibile dopo lo screen; da un LWC genitore si legge con `querySelector`.                                                                                                     |
| `surveyResponseId` | String        | `@api` getter (read-only) | Id del `Survey_Response__c` creato; `null` in `previewMode`. Output Flow, disponibile quando `isCompleted` è `true`.                                                                                                                                                |
| `surveycompleted`  | Evento custom | `dispatchEvent`           | Sparato subito dopo la submission (reale o in anteprima), `detail: { surveyResponseId, preview }`. È il modo **idiomatico** per un LWC genitore di reagire al completamento, senza fare polling sulle proprietà. Flow non ascolta eventi DOM: usa gli output sopra. |

`isCompleted` e `surveyResponseId` sono implementati come getter pubblici sostenuti da campi privati (`_isCompleted`, `_surveyResponseId`), non come proprietà `@api` scrivibili — è il pattern corretto per un "output": il componente li imposta internamente, il consumer li legge, mai il contrario (la regola ESLint `@lwc/lwc/no-api-reassignments` lo impone).

Il componente espone inoltre il metodo pubblico `@api refresh()`: ricarica grafo, testi e tema preservando quando possibile posizione e risposte correnti — è ciò che l'editor experience invoca dopo ogni salvataggio per l'anteprima live.

### 5.3 Uso in un Flow (screen flow)

Target `lightning__FlowScreen` con un `targetConfig` dedicato (proprietà distinte da quelle di App Builder, con `role="inputOnly"`/`role="outputOnly"` espliciti): `surveyName`, `entityMapping`, `entityMappingField`, `recordId` in input; `isCompleted`, `surveyResponseId` in output.

Differenza chiave rispetto ad App Builder: **niente auto-injection**. Ogni proprietà, incluso `recordId`, va collegata esplicitamente nel pannello di configurazione dello screen element scegliendo una risorsa/variabile del Flow da un menu (non testo libero — quindi niente rischio dell'errore "the correct format is `{!$Label...}`" che si otterrebbe digitando `{!recordId}` a mano). Per avere l'Id del record in un Flow lanciato da una record page, crea nel Flow una variabile Text di **Input** con API Name `recordId` (Salesforce la popola da sola con l'Id del record di lancio), poi collegala alla proprietà `Record Id` del componente. `Entity Mapping Field` indica su quale lookup scriverlo (es. `Account__c`).

Dopo lo screen con il survey, uno step successivo (Decision, Assignment, ecc.) può leggere `isCompleted` e `surveyResponseId` come output del componente per ramificare il Flow.

### 5.4 Composizione in un altro LWC

Essendo `surveyRunner` un componente come un altro, è già componibile via markup da qualunque LWC dello stesso namespace (la proprietà `isExposed` regola solo il posizionamento da Builder/Flow, non la composizione via markup):

```html
<c-survey-runner
  survey-name="Coffee_Break_Survey"
  entity-mapping-field="Account__c"
  record-id="{recordId}"
  onsurveycompleted="{handleSurveyCompleted}"
></c-survey-runner>
```

Il genitore deve fornire `record-id` esplicitamente (nessuna auto-injection al di fuori di App Builder): se è lui stesso su una Record Page può ridichiarare `@api recordId;` e ripassarlo giù; altrimenti lo calcola/ottiene diversamente. In alternativa, avendo pieno controllo JS, il genitore può costruirsi da sé il JSON e passarlo via `entity-mapping`, senza passare da `entityMappingField`/`recordId`. Per reagire al completamento, il genitore ascolta l'evento:

```js
handleSurveyCompleted(event) {
    const { surveyResponseId, preview } = event.detail;
    // naviga, mostra un toast, chiude un modal, ecc.
}
```

Comportamento (dal sorgente, 372 righe JS + 168 HTML + 156 CSS):

- **Load** (`connectedCallback`): carica il survey via `getSurveyByName` (o `getSurveyById` in anteprima). **Risoluzione del tema** (`resolveTheme`): tema da record (`SurveyDTO.theme`, normalizzato in token CSS — `borderRadius` numerico diventa `Npx`); senza tema si usano i default del componente. Errori di load → schermata di errore.
- **Tema**: `applyTheme()` mappa i token sulle CSS custom properties dell'host (`--survey-primary`, `--survey-bg`, `--survey-surface`, `--survey-text`, `--survey-muted`, `--survey-error`, `--survey-radius`, `--survey-font`, `--survey-logo-height`), riapplicandole a ogni render e **rimuovendo** le property dei token assenti (così in anteprima live un colore o un'altezza cancellati tornano al default). **Testi di cornice**: campi del record Survey (`displayTitle`, `introText`, `closingMessage`, label bottoni) con fallback su Name, `Description__c` e stringhe italiane hardcoded. Il logo è il File del record tema, renderizzato con `height: var(--survey-logo-height)` e `width: auto` (default 60px, proporzioni sempre mantenute).
- **Rendering per tipo**: radio (SingleChoice), checkbox (MultiChoice), textarea/input (FreeText/Scale/Date via il set `FREE_TEXT_TYPES`); opzione con `allowsFreeText` selezionata mostra l'input companion "Altro".
- **Navigazione**: una domanda per schermata; `history` (stack) per il bottone Indietro; progress bar calcolata come domande viste / totale domande. `isLastQuestion` è un check **strutturale** (nessun arco uscente possibile), con commento nel codice che documenta il bugfix: il vecchio calcolo basato sulla risposta corrente mostrava "Invia" prima della scelta permettendo submission premature.
- **Validazione client** (`validateAnswer`): required, regex della domanda (per i tipi free-text), obbligo e regex del testo libero companion per le opzioni `allowsFreeText`. Regex malformata → messaggio "admin error" non bloccante del browser.
- **Next** (`computeNextQuestionId`): implementa le regole di navigazione (vedi [02-data-model.md](02-data-model.md) §6). Next `null` → submission diretta.
- **Submission** (`handleSubmit`): serializza `{surveyId, entityMappingJson, answers[]}` e chiama `submitResponse`; a successo mostra la schermata di chiusura con `closingMessage`. Nota: vengono inviate **tutte le risposte raccolte nella `Map` answers**, incluse quelle date su rami poi abbandonati tornando indietro (nessuna potatura del percorso).

Nota di layout: il tema di default dichiara `layout.onePerScreen`, ma il componente ignora questa chiave — il rendering è comunque sempre una domanda per schermata.

## 6. LWC `surveyAuthor` — editor a grafo (esposto: App/Home Page)

Editor visuale (~1030 righe JS + 360 HTML + 315 CSS) interamente **SVG scritto a mano** (nessuna libreria esterna, a differenza dell'ipotesi del design di usare una libreria di diagrammi come static resource):

- **Selezione survey**: `lightning-record-picker` su `Survey__c` (mostra Name + Status), più bottone **"Nuovo survey"** con mini-form inline (nome + Crea/Annulla, Invio per confermare): crea il record in stato Draft via `createRecord` e lo apre subito nell'editor.
- **Canvas**: nodi = domande con titolo word-wrappato (max 3 righe), tipo, e una riga per ogni opzione + eventuale riga "↪ default" + riga "— end —" per i terminali; archi = curve di Bézier dalle "porte" delle righe al nodo target, con label. Classi CSS di stato: `is-start`, `is-selected`, `is-cycle`, `is-orphan` (evidenziazione dei problemi rilevati).
- **Layout**: auto-layout **BFS a colonne** per profondità dal nodo di start (ordinate per `Order__c`), oppure layout manuale con drag & drop; le posizioni manuali persistono su `Editor_X__c`/`Editor_Y__c` (arrotondate) via `updateRecord`. I mousemove sono coalizzati con `requestAnimationFrame` (una paint per frame, commento nel codice). Il map `pendingPositions` mantiene le posizioni in-flight finché il wire non riflette il valore salvato (riconciliazione con tolleranza ±1px).
- **Creazione archi**: drag da una porta (opzione / default / terminal) a un nodo target → `updateRecord` su `Answer_Option__c.Next_Question__c` (porta opzione) o `Question__c.Default_Next_Question__c` (porta default o terminal), con linea di anteprima durante il drag.
- **Inspector**: pannello di edit della domanda selezionata (testo, tipo, required, order, regex, placeholder, default next) e delle sue opzioni (testo, order, allows free text, regex, next), con **mutazione ottimistica locale + salvataggio debounced per campo (400 ms)** via `updateRecord`; `flushPendingSaves()` scarica i salvataggi pendenti prima di ogni refresh.
- **Azioni**: aggiungi domanda (posizione random, testo "Nuova domanda", `SingleChoice`), aggiungi opzione ("Nuova opzione", order progressivo), elimina domanda/opzione (con `window.confirm`; la cancellazione domanda sfrutta il cascade del master-detail sulle opzioni), "Set as start" (aggiorna `Survey__c.Start_Question__c`), "Valida" (chiama `validateGraph` e colora nodi in ciclo/orfani), refresh (`refreshApex`).
- **"Esporta risposte"**: chiama `SurveyExportController.exportResponsesCsv(surveyId)` e scarica il CSV pivotato nel browser (`Blob` + link temporaneo `<a download>`, con BOM UTF-8 per la corretta resa degli accenti in Excel). Bottone disabilitato senza survey selezionato o a export in corso. Nome file derivato dal nome del survey (sanificato). Dettagli del formato in §3 "Export CSV pivotato".
- Toast SLDS per esiti e errori; messaggi utente in italiano.

## 6b. LWC `surveyExperienceEditor` — editor dell'experience (R13; esposto: App/Home Page)

Editor point-and-click di tema e testi con **anteprima live**, ospitato dalla FlexiPage `Survey_Experience_Page` (tab `Survey_Experience` nella console). Layout a due colonne: pannello di configurazione a sinistra, anteprima a destra (`c-survey-runner` con `surveyId` + `previewMode`).

- **Selezione survey**: `lightning-record-picker` su `Survey__c` (Name + Status); la creazione di nuovi survey avviene nel `surveyAuthor`.
- **Sezione Tema**: record-picker su `Survey_Theme__c` per assegnare/cambiare/rimuovere il tema del survey; bottone **"Nuovo tema"** con mini-form inline per **scegliere il nome** (Invio per confermare): crea il `Survey_Theme__c` con i default del tema standard e lo assegna al survey; sei righe colore con **input color nativo** + hex + bottone "✕" per tornare al default; number input per il border radius; text input per il font; toggle per la progress bar. Avviso contestuale: **tema condiviso** ("questo tema è usato da N survey: le modifiche impattano tutti", da `usageCount`).
- **Logo**: `lightning-file-upload` agganciato al record tema; a upload completato chiama `registerThemeLogo` (visibility `AllUsers`) e mostra l'anteprima del file corrente. Accanto, un number input **"Altezza logo (px)"** (`Logo_Height__c`, 10–400, default 60) ridimensiona sia l'anteprima nel pannello sia il logo nel runner, mantenendo sempre le proporzioni originali dell'immagine (solo l'altezza è configurabile, la larghezza segue).
- **Sezione Testi**: input/textarea per i sei campi testo di `Survey__c`, con i fallback mostrati come placeholder (Name, Description).
- **Persistenza**: stesso pattern del `surveyAuthor` — mutazione ottimistica locale + salvataggio **debounced 400 ms per campo** via `lightning/uiRecordApi.updateRecord` (CRUD/FLS/sharing nativi, nessun Apex di scrittura salvo il logo); dopo ogni save, `refreshApex` del wire e `refresh()` del runner per aggiornare l'anteprima.

## 7. Temi: dove vivono ora

I temi sono record `Survey_Theme__c` (vedi [02-data-model.md](02-data-model.md) §2b).

## 8. UI: app, pagina, tab, layout

- **App `Survey_Console`** (Lightning, form factor Large, header `#16325c`): tab in ordine — `Survey_Author`, `Survey_Experience`, `Survey__c`, `Question__c`, `Answer_Option__c`, `Survey_Theme__c`, `Survey_Response__c`, `Question_Response__c`. Descrizione: console per progettare survey, monitorarne le risposte e accedere agli editor.
- **FlexiPage** (App Page, template `defaultAppHomeTemplate`, una regione ciascuna): `Survey_Author_Page` (ospita `c:surveyAuthor`, tab `Survey_Author`, motif Bell) e `Survey_Experience_Page` (ospita `c:surveyExperienceEditor`, tab `Survey_Experience`, motif Palette — R13).
- **Tab oggetto**: una per ciascuno dei 6 oggetti custom.
- **Page layout**: uno per oggetto; il layout Survey include le sezioni "Configurazione" (con `Theme__c`) ed "Experience Texts"; il layout del tema separa impostazioni e colori.
- Il **runner non ha una pagina dedicata nel repo**: è pensato per essere piazzato dagli admin su App/Record/Home Page via App Builder, dentro uno screen Flow, o composto in un altro LWC — configurando `surveyName` ed `entityMapping`/`entityMappingField` per contesto (vedi §5.3-5.4 sopra).
