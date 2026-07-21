# 05 — Apex, Lightning Web Components e UI

> Fonti: `classes/*.cls`, `lwc/**`, `staticresources/*`, `applications/`, `flexipages/`, `tabs/`, `layouts/`.

## 1. Architettura del codice

```
LWC surveyRunner (compilazione)          LWC surveyAuthor (editor a grafo)
        │  @salesforce/apex                      │ @wire getSurveyById / validateGraph
        ▼                                        │ + lightning/uiRecordApi (CRUD diretto)
SurveyController  ──────────────────────────────►│
  (facade @AuraEnabled, with sharing)            │
        ▼                                        ▼
SurveyService (business logic, with sharing, WITH SECURITY_ENFORCED)
        ▼
Survey__c / Question__c / Answer_Option__c / Survey_Response__c / Question_Response__c
```

Pattern **Controller sottile + Service**: `SurveyController` si limita a delegare, convertire JSON e rilanciare ogni eccezione come `AuraHandledException` (l'unico tipo che porta un messaggio pulito al LWC). Tutta la logica è in `SurveyService`. L'editor, per le **scritture**, non passa da Apex ma da `lightning/uiRecordApi`, così CRUD/FLS/sharing sono applicati nativamente dalla piattaforma.

## 2. SurveyController (78 righe, API 66.0, `with sharing`)

| Metodo | Firma | Cacheable | Uso |
| --- | --- | --- | --- |
| `getSurveyByName` | `(String surveyName) → SurveyDTO` | Sì | Load del runner: solo survey `Active`. |
| `getSurveyById` | `(Id surveyId) → SurveyDTO` | Sì | Load dell'editor (qualsiasi status, anche Draft). |
| `submitResponse` | `(String submissionJson) → SubmissionResult` | No | Submission: deserializza il JSON in `SubmissionRequest` e delega. |
| `validateGraph` | `(Id surveyId) → GraphValidationResult` | No | Bottone "Valida" dell'editor. |
| `getThemeJson` | `(String resourceName) → String` | Sì | Restituisce il body della StaticResource del tema come testo (il LWC fa il parse JSON). Fatto in Apex — e non via `fetch('/resource/...')` — per evitare la costruzione di URL namespaced e avere un unico punto di lettura. Query `WITH SECURITY_ENFORCED`, ritorna `null` se la risorsa non esiste. |

## 3. SurveyService (485 righe, API 66.0, `with sharing`)

Costante: `MAX_GRAPH_NODES = 500` (`@TestVisible`) — un survey con ≥500 domande viene rifiutato al load con l'indicazione di dividerlo.

### DTO esposti al LWC (tutti con campi `@AuraEnabled`)

- `SurveyDTO` (id, name, description, status, version, themeStaticResource, startQuestionId, `List<QuestionDTO>`)
- `QuestionDTO` (testo, tipo, required, orderHint, regex+messaggio, placeholder, defaultNextQuestionId, editorX/Y, `List<OptionDTO>`)
- `OptionDTO` (testo, orderHint, nextQuestionId, allowsFreeText, freeTextRegex+messaggio)
- `SubmissionRequest` (surveyId, entityMappingJson, `List<AnswerInput>`), `AnswerInput` (questionId, selectedOptionIds, freeTextValue)
- `SubmissionResult` (surveyResponseId, questionResponsesCreated), `GraphValidationResult` (isValid, errors, cycles)
- `SurveyException` (custom exception unica del modulo)

### Caricamento (`loadActiveSurveyByName`, `loadSurveyById`, `buildSurveyDTO`)

- `loadActiveSurveyByName`: cerca per `Name` esatto, pretende `Status__c = 'Active'` e `Start_Question__c` valorizzato; altrimenti `SurveyException` con messaggio parlante.
- `loadSurveyById`: nessun vincolo di status (serve all'editor per lavorare sui Draft).
- `buildSurveyDTO`: 2 SOQL (domande ordinate per `Order__c NULLS LAST, CreatedDate`; opzioni delle domande con stesso ordinamento), raggruppa le opzioni per domanda e materializza il DTO. Nessuna query in loop.

### Submission (`submitResponse`)

1. Valida input (surveyId e answers obbligatori).
2. **Ricarica il grafo dal DB** — così gli snapshot fotografano il testo *corrente* al momento della scrittura, non quello che il client aveva in memoria.
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

## 4. SurveyServiceTest (450 righe, 18 metodi di test)

Seed condiviso `seedLinearSurvey(status)`: survey con 3 domande (Q1 SingleChoice required con 2 opzioni, Q2 FreeText con regex `^\d{2}$`, Q3 terminale), opzione A → Q2, opzione B terminale, Q2 → Q3 via default next.

Copertura per area:

| Area | Test |
| --- | --- |
| Load | grafo completo restituito; survey non-Active → errore; start mancante → errore; nome blank → errore |
| Submission | snapshot corretti e sessione popolata (data, utente); multi-choice → 2 record; required senza risposta → errore; questionId sconosciuto → errore |
| Entity mapping | popolamento `Account__c`; campo inesistente → errore; Id di tipo sbagliato (Contact su lookup Account) → errore; campo non-lookup → errore |
| Graph validation | grafo pulito valido; ciclo rilevato; orfano rilevato |
| Controller (smoke) | `getSurveyByName`, `submitResponse` (payload JSON reale), `validateGraph` |

Assenza nota: **nessun test Jest per i LWC** (toolchain configurata ma cartelle `__tests__` assenti).

## 5. LWC `surveyRunner` — compilazione (esposto: App/Record/Home Page)

Proprietà configurabili dal Lightning App Builder (dal `js-meta.xml`):

| Proprietà | Tipo | Significato |
| --- | --- | --- |
| `surveyName` | String | `Name` del record `Survey__c` da erogare; deve essere Active. |
| `entityMapping` | String | JSON `{campo lookup su Survey_Response__c → recordId}`, passato tal quale ad Apex alla submission. |

Comportamento (dal sorgente, 372 righe JS + 168 HTML + 156 CSS):

- **Load** (`connectedCallback`): carica il survey via `getSurveyByName`; se `themeStaticResource` è valorizzato carica il tema via `getThemeJson` (un tema malformato **non è fatale**: si degrada ai default). Errori di load → schermata di errore.
- **Tema**: `applyTheme()` mappa `theme.tokens` sulle CSS custom properties dell'host (`--survey-primary`, `--survey-bg`, `--survey-surface`, `--survey-text`, `--survey-muted`, `--survey-error`, `--survey-radius`, `--survey-font`), riapplicandole a ogni render. Dal tema arrivano anche `title`, `intro`, `logoUrl`, `closingMessage`, label dei bottoni (`labels.next/back/submit`) e `layout.showProgressBar` (default on); i fallback sono il nome/descrizione del survey e stringhe italiane hardcoded.
- **Rendering per tipo**: radio (SingleChoice), checkbox (MultiChoice), textarea/input (FreeText/Scale/Date via il set `FREE_TEXT_TYPES`); opzione con `allowsFreeText` selezionata mostra l'input companion "Altro".
- **Navigazione**: una domanda per schermata; `history` (stack) per il bottone Indietro; progress bar calcolata come domande viste / totale domande. `isLastQuestion` è un check **strutturale** (nessun arco uscente possibile), con commento nel codice che documenta il bugfix: il vecchio calcolo basato sulla risposta corrente mostrava "Invia" prima della scelta permettendo submission premature.
- **Validazione client** (`validateAnswer`): required, regex della domanda (per i tipi free-text), obbligo e regex del testo libero companion per le opzioni `allowsFreeText`. Regex malformata → messaggio "admin error" non bloccante del browser.
- **Next** (`computeNextQuestionId`): implementa le regole di navigazione (vedi [02-data-model.md](02-data-model.md) §6). Next `null` → submission diretta.
- **Submission** (`handleSubmit`): serializza `{surveyId, entityMappingJson, answers[]}` e chiama `submitResponse`; a successo mostra la schermata di chiusura con `closingMessage`. Nota: vengono inviate **tutte le risposte raccolte nella `Map` answers**, incluse quelle date su rami poi abbandonati tornando indietro (nessuna potatura del percorso).

Nota di layout: il tema di default dichiara `layout.onePerScreen`, ma il componente ignora questa chiave — il rendering è comunque sempre una domanda per schermata.

## 6. LWC `surveyAuthor` — editor a grafo (esposto: App/Home Page)

Editor visuale (948 righe JS + 334 HTML + 300 CSS) interamente **SVG scritto a mano** (nessuna libreria esterna, a differenza dell'ipotesi del design di usare una libreria di diagrammi come static resource):

- **Selezione survey**: `lightning-record-picker` su `Survey__c` (mostra Name + Status).
- **Canvas**: nodi = domande con titolo word-wrappato (max 3 righe), tipo, e una riga per ogni opzione + eventuale riga "↪ default" + riga "— end —" per i terminali; archi = curve di Bézier dalle "porte" delle righe al nodo target, con label. Classi CSS di stato: `is-start`, `is-selected`, `is-cycle`, `is-orphan` (evidenziazione dei problemi rilevati).
- **Layout**: auto-layout **BFS a colonne** per profondità dal nodo di start (ordinate per `Order__c`), oppure layout manuale con drag & drop; le posizioni manuali persistono su `Editor_X__c`/`Editor_Y__c` (arrotondate) via `updateRecord`. I mousemove sono coalizzati con `requestAnimationFrame` (una paint per frame, commento nel codice). Il map `pendingPositions` mantiene le posizioni in-flight finché il wire non riflette il valore salvato (riconciliazione con tolleranza ±1px).
- **Creazione archi**: drag da una porta (opzione / default / terminal) a un nodo target → `updateRecord` su `Answer_Option__c.Next_Question__c` (porta opzione) o `Question__c.Default_Next_Question__c` (porta default o terminal), con linea di anteprima durante il drag.
- **Inspector**: pannello di edit della domanda selezionata (testo, tipo, required, order, regex, placeholder, default next) e delle sue opzioni (testo, order, allows free text, regex, next), con **mutazione ottimistica locale + salvataggio debounced per campo (400 ms)** via `updateRecord`; `flushPendingSaves()` scarica i salvataggi pendenti prima di ogni refresh.
- **Azioni**: aggiungi domanda (posizione random, testo "Nuova domanda", `SingleChoice`), aggiungi opzione ("Nuova opzione", order progressivo), elimina domanda/opzione (con `window.confirm`; la cancellazione domanda sfrutta il cascade del master-detail sulle opzioni), "Set as start" (aggiorna `Survey__c.Start_Question__c`), "Valida" (chiama `validateGraph` e colora nodi in ciclo/orfani), refresh (`refreshApex`).
- Toast SLDS per esiti e errori; messaggi utente in italiano.

## 7. Static resource: i temi

Struttura JSON osservata nei due temi versionati (`Survey_Theme_Default`, `Survey_Theme_Christmas`), coerente con quanto consumato dal runner:

```json
{
  "tokens":  { "primary", "background", "surface", "text", "muted", "error", "radius", "fontFamily" },
  "logoUrl": "string | null",
  "title": "...", "intro": "...", "closingMessage": "...",
  "labels":  { "next", "back", "submit" },
  "layout":  { "showProgressBar": true, "onePerScreen": true }
}
```

- `Survey_Theme_Default`: palette SLDS-like (blu `#0070d2`), testi neutri in italiano.
- `Survey_Theme_Christmas`: palette natalizia (rosso `#c8102e` su verde scuro), font serif, testi di cornice a tema — dimostra il requisito "tema per occasione" del design.
- Entrambe le resource sono `cacheControl: Public`, `contentType: application/json` (dal file `.resource-meta.xml`).

## 8. UI: app, pagina, tab, layout

- **App `Survey_Console`** (Lightning, form factor Large, header `#16325c`): tab in ordine — `Survey_Author`, `Survey__c`, `Question__c`, `Answer_Option__c`, `Survey_Response__c`, `Question_Response__c`. Descrizione: console per progettare survey, monitorare le risposte e accedere all'editor a grafo.
- **FlexiPage `Survey_Author_Page`** (App Page, template `defaultAppHomeTemplate`, una regione): contiene solo `c:surveyAuthor`. È referenziata dalla **tab `Survey_Author`** (motif "Custom17: Bell").
- **Tab oggetto**: una per ciascuno dei 5 oggetti custom.
- **Page layout**: uno per oggetto (default, senza personalizzazioni degne di nota ai fini architetturali).
- Il **runner non ha una pagina dedicata nel repo**: è pensato per essere piazzato dagli admin su App/Record/Home Page via App Builder, configurando `surveyName` ed `entityMapping` per contesto.

Confermato: il posizionamento di `surveyRunner` avviene **direttamente in org** via Lightning App Builder (nessuna FlexiPage versionata nel repo che lo contenga); pagine e mapping sono quindi configurazione locale dell'org che lo utilizza.