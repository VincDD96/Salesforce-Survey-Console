# 01 — Panoramica del progetto e inventario metadati

> Documentazione generata dal codice sorgente del repository (formato Salesforce DX).
> Fonti: metadati in `force-app/main/default/`

## 1. Che cos'è questo progetto

**Survey** è un componente Salesforce riutilizzabile per somministrare **questionari condizionali** (la domanda successiva dipende dalla risposta data) interamente dentro pagine Lightning interne, e per salvarne i risultati in oggetti custom. Le caratteristiche fondanti, dichiarate nel documento di design (`docs/design.md`) e riscontrate nell'implementazione, sono:

- **Configurabilità totale via oggetti custom**: un nuovo questionario non richiede modifiche al codice. Il questionario è modellato come **grafo diretto** di domande (`Question__c`) collegate da archi (`Answer_Option__c.Next_Question__c` e `Question__c.Default_Next_Question__c`), con nodo di partenza in `Survey__c.Start_Question__c`. Le convergenze sono ammesse, i cicli vietati (rilevati da `SurveyService.validateGraph`).
- **Theming su record + editor point-and-click (R13)**: l'estetica vive sull'oggetto `Survey_Theme__c` (token colori, font, radius, logo come File), riusabile su più survey via `Survey__c.Theme__c`; i testi di cornice sono campi del Survey. Il tema è applicato come CSS custom properties sull'host del componente, non come CSS iniettato nello Shadow DOM.
- **Collegamento dinamico alle entità**: il componente di compilazione riceve un JSON `{ "Account__c": "001...", ... }` e a runtime popola i lookup omonimi su `Survey_Response__c`, con validazione di esistenza del campo e coerenza del tipo di Id. Per collegare una nuova entità basta aggiungere un campo lookup (solo metadato).
- **Versioning per snapshot alla scrittura**: ogni `Question_Response__c` congela testo della domanda, testo della risposta, nome e versione del survey al momento del salvataggio. Lo storico resta coerente anche se il questionario viene modificato in seguito.
- **Salvataggio unico finale**: la compilazione non è ripristinabile (scelta di design); tutto lo stato vive nel LWC e la submission è un'unica transazione DML con savepoint/rollback.
- **Strumento di authoring visuale a grafo** (`surveyAuthor`): editor SVG stile "flow" con auto-layout BFS, drag & drop dei nodi, creazione archi via trascinamento, pannello di ispezione e validazione del grafo (cicli, nodi orfani, start mancante).

## 2. Inventario metadati

| Tipo di metadato                       | Conteggio | Elementi                                                                                                                        |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Custom Object                          | 6         | `Survey__c`, `Question__c`, `Answer_Option__c`, `Survey_Response__c`, `Question_Response__c`, `Survey_Theme__c`                 |
| Custom Field                           | 51        | vedi [02-data-model.md](02-data-model.md)                                                                                       |
| Classi Apex                            | 4         | `SurveyService`, `SurveyController`, `SurveyExportController`, `SurveyServiceTest`                                              |
| Lightning Web Component                | 3         | `surveyRunner` (compilazione), `surveyAuthor` (editor a grafo), `surveyExperienceEditor` (editor tema/testi con anteprima live) |
| Permission Set                         | 2         | `Survey_Admin`, `Survey_Respondent`                                                                                             |
| Custom Application                     | 1         | `Survey_Console`                                                                                                                |
| FlexiPage (App Page)                   | 2         | `Survey_Author_Page`, `Survey_Experience_Page`                                                                                  |
| Custom Tab                             | 8         | 6 tab oggetto + `Survey_Author` + `Survey_Experience`                                                                           |
| Page Layout                            | 6         | uno per oggetto                                                                                                                 |
| Validation Rule                        | 6         | formato hex dei colori su `Survey_Theme__c`                                                                                     |
| Trigger Apex                           | 0         | —                                                                                                                               |
| Flow / Process Builder / Workflow Rule | 0         | —                                                                                                                               |
| Record Type                            | 0         | —                                                                                                                               |
| Profili                                | 0         | (accessi gestiti solo via permission set)                                                                                       |

API version del progetto e dei componenti: **66.0** (`sfdx-project.json`, meta LWC e classi).

## 3. Struttura del repository

```
Survey/
├── sfdx-project.json          # progetto DX, package dir force-app, API 66.0
├── config/project-scratch-def.json
├── manifest/
│   ├── package.xml            # manifest completo di tutti i metadati
│   ├── core.xml               # sottoinsieme "core" (oggetti, campi, Apex, LWC, ...)
│   └── addon.xml              # sottoinsieme "addon" (app, flexipage, tab, PS, LWC)
├── force-app/main/default/    # tutti i metadati (elencati sopra)
├── docs/design.md             # documento di architettura e decisioni (pre-sviluppo)
├── scripts/                   # snippet di comodo (hello.apex, account.soql)
├── package.json               # toolchain: eslint, prettier, sfdx-lwc-jest, husky
├── jest.config.js, eslint.config.js
└── README.md                  # boilerplate standard SFDX
```

Il manifest è disponibile sia completo (`package.xml`) sia diviso in due sottoinsiemi (`core.xml` / `addon.xml`). Il deploy avviene manualmente tramite il manifest `package.xml` (es. `sf project deploy start -x manifest/package.xml`); non esiste una pipeline CI/CD.

## 4. Attori e percorsi utente

| Attore                          | Permission set      | Strumenti                                                                                          | Cosa fa                                                                                                                                                      |
| ------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Admin / Author**              | `Survey_Admin`      | App `Survey_Console`, tab `Survey Author` (editor a grafo), tab oggetto                            | Progetta i questionari: crea domande/opzioni, disegna gli archi, imposta lo start, valida il grafo, attiva il survey (`Status__c = Active`).                 |
| **Respondent (utente interno)** | `Survey_Respondent` | LWC `surveyRunner` inserito in App/Record/Home Page, in uno screen Flow o composto in un altro LWC | Compila il questionario Active indicato dalla proprietà `surveyName`, con navigazione avanti/indietro e progress bar; alla fine viene salvata la submission. |

Lo scope dichiarato nel design è **solo pagine interne Salesforce** (nessuna Experience Cloud / community nel repo).

Non sono definiti volumi attesi di utilizzo. I **limiti tecnici correnti** del componente, codificati nel repo, sono:

| Limite                               | Valore                                                                                | Dove                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Domande per survey                   | max 500 (`MAX_GRAPH_NODES`) — oltre, il load fallisce con invito a dividere il survey | `SurveyService`                                                         |
| Lunghezza regex e messaggi di errore | 255 caratteri                                                                         | campi `Validation_Regex__c`, `Free_Text_Regex__c`, `*_Error_Message__c` |
| Lunghezza testi liberi e snapshot    | 32.768 caratteri (Long Text Area)                                                     | `Free_Text_Value__c`, campi `*_Snapshot__c`, `Question_Text__c`         |
| DML per submission                   | 2 insert in un'unica transazione (sessione + risposte)                                | `SurveyService.submitResponse`                                          |
| Salvataggi editor                    | debounce 400 ms per campo, un `updateRecord` per modifica quiescente                  | `surveyAuthor`                                                          |
