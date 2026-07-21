# 01 — Panoramica del progetto e inventario metadati

> Documentazione generata dal codice sorgente del repository (formato Salesforce DX).
> Fonti: metadati in `force-app/main/default/`, documento di design `docs/design.md`.
> Il repository non è un repository git inizializzato: non è disponibile uno storico commit.

## 1. Che cos'è questo progetto

**Survey** è un componente Salesforce riutilizzabile per somministrare **questionari condizionali** (la domanda successiva dipende dalla risposta data) interamente dentro pagine Lightning interne, e per salvarne i risultati in oggetti custom. Le caratteristiche fondanti, dichiarate nel documento di design (`docs/design.md`) e riscontrate nell'implementazione, sono:

- **Configurabilità totale via oggetti custom**: un nuovo questionario non richiede modifiche al codice. Il questionario è modellato come **grafo diretto** di domande (`Question__c`) collegate da archi (`Answer_Option__c.Next_Question__c` e `Question__c.Default_Next_Question__c`), con nodo di partenza in `Survey__c.Start_Question__c`. Le convergenze sono ammesse, i cicli vietati (rilevati da `SurveyService.validateGraph`).
- **Theming via static resource JSON**: il campo `Survey__c.Theme_Static_Resource__c` punta esplicitamente a una static resource JSON (palette, font, logo, testi di cornice, flag di layout). Il tema è applicato come CSS custom properties sull'host del componente, non come CSS iniettato nello Shadow DOM.
- **Collegamento dinamico alle entità**: il componente di compilazione riceve un JSON `{ "Account__c": "001...", ... }` e a runtime popola i lookup omonimi su `Survey_Response__c`, con validazione di esistenza del campo e coerenza del tipo di Id. Per collegare una nuova entità basta aggiungere un campo lookup (solo metadato).
- **Versioning per snapshot alla scrittura**: ogni `Question_Response__c` congela testo della domanda, testo della risposta, nome e versione del survey al momento del salvataggio. Lo storico resta coerente anche se il questionario viene modificato in seguito.
- **Salvataggio unico finale**: la compilazione non è ripristinabile (scelta di design); tutto lo stato vive nel LWC e la submission è un'unica transazione DML con savepoint/rollback.
- **Strumento di authoring visuale a grafo** (`surveyAuthor`): editor SVG stile "flow" con auto-layout BFS, drag & drop dei nodi, creazione archi via trascinamento, pannello di ispezione e validazione del grafo (cicli, nodi orfani, start mancante).

Il reporting è previsto su **CRM Analytics** (fuori dal repo): la denormalizzazione per snapshot serve proprio a semplificare recipe/dataflow.

## 2. Inventario metadati

| Tipo di metadato | Conteggio | Elementi |
| --- | --- | --- |
| Custom Object | 5 | `Survey__c`, `Question__c`, `Answer_Option__c`, `Survey_Response__c`, `Question_Response__c` |
| Custom Field | 36 | vedi [02-data-model.md](02-data-model.md) |
| Classi Apex | 3 | `SurveyService`, `SurveyController`, `SurveyServiceTest` |
| Lightning Web Component | 2 | `surveyRunner` (compilazione), `surveyAuthor` (editor a grafo) |
| Permission Set | 2 | `Survey_Admin`, `Survey_Respondent` |
| Custom Application | 1 | `Survey_Console` |
| FlexiPage (App Page) | 1 | `Survey_Author_Page` (ospita `c:surveyAuthor`) |
| Custom Tab | 6 | 5 tab oggetto + `Survey_Author` (tab della FlexiPage) |
| Page Layout | 5 | uno per oggetto |
| Static Resource | 2 | `Survey_Theme_Default`, `Survey_Theme_Christmas` (JSON di tema) |
| Trigger Apex | 0 | — |
| Flow / Process Builder / Workflow Rule | 0 | — |
| Validation Rule | 0 | — |
| Record Type | 0 | — |
| Profili | 0 | (accessi gestiti solo via permission set) |

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

| Attore | Permission set | Strumenti | Cosa fa |
| --- | --- | --- | --- |
| **Admin / Author** | `Survey_Admin` | App `Survey_Console`, tab `Survey Author` (editor a grafo), tab oggetto | Progetta i questionari: crea domande/opzioni, disegna gli archi, imposta lo start, valida il grafo, attiva il survey (`Status__c = Active`). |
| **Respondent (utente interno)** | `Survey_Respondent` | LWC `surveyRunner` inserito in App/Record/Home Page | Compila il questionario Active indicato dalla proprietà `surveyName`, con navigazione avanti/indietro e progress bar; alla fine viene salvata la submission. |

Lo scope dichiarato nel design è **solo pagine interne Salesforce** (nessuna Experience Cloud / community nel repo).

Non sono definiti volumi attesi di utilizzo. I **limiti tecnici correnti** del componente, codificati nel repo, sono:

| Limite | Valore | Dove |
| --- | --- | --- |
| Domande per survey | max 500 (`MAX_GRAPH_NODES`) — oltre, il load fallisce con invito a dividere il survey | `SurveyService` |
| Lunghezza regex e messaggi di errore | 255 caratteri | campi `Validation_Regex__c`, `Free_Text_Regex__c`, `*_Error_Message__c` |
| Lunghezza testi liberi e snapshot | 32.768 caratteri (Long Text Area) | `Free_Text_Value__c`, campi `*_Snapshot__c`, `Question_Text__c` |
| DML per submission | 2 insert in un'unica transazione (sessione + risposte) | `SurveyService.submitResponse` |
| Salvataggi editor | debounce 400 ms per campo, un `updateRecord` per modifica quiescente | `surveyAuthor` |

**Stato di adozione**: al momento nessuna org di produzione ospita questo componente (progetto in fase di sviluppo/pre-rilascio).

## 5. Scostamenti e punti aperti rispetto al design

Confronto tra `docs/design.md` e l'implementazione effettiva:

| Tema del design | Stato nell'implementazione |
| --- | --- |
| Modello a grafo, start su Survey, snapshot, multi-choice = 1 record per opzione | ✅ Implementati come da design |
| Theming JSON → CSS custom properties | ✅ Implementato (`surveyRunner.applyTheme`) |
| Mapping JSON entità dinamiche con validazione runtime | ✅ Implementato (`SurveyService.applyEntityMapping`) |
| Editor a grafo in LWC con libreria di diagrammi come static resource | ⚠️ Parziale: l'editor esiste ma è **SVG scritto a mano** nel componente, senza libreria esterna. Aggiunti i campi `Editor_X__c`/`Editor_Y__c` (non previsti dal design) per persistere le posizioni dei nodi. |
| Validazione della regex stessa al salvataggio nell'editor (anti-ReDoS) | ❌ Non implementata: l'editor salva la regex senza verificarla; il runner la compila a runtime e mostra "Regex di validazione non valida (admin error)" se malformata. |
| Protezione anti-doppia-compilazione | ❌ Non implementata (nel design era "da decidere"). |
| Anteprima del questionario nell'editor | ❌ Non presente nell'editor. |
| Localizzazione/traduzioni | ❌ Non presente (label di fallback hardcoded in italiano nel runner). |

I punti non implementati (validazione regex in authoring, anti-doppia compilazione, anteprima, localizzazione) sono **roadmap attiva**: sono censiti, insieme agli altri interventi decisi, in [07-roadmap.md](07-roadmap.md).

## 6. Toolchain di sviluppo

- **Lint/format**: ESLint 9 con i plugin ufficiali LWC/Aura/Lightning; Prettier con plugin XML e Apex; husky + lint-staged per il pre-commit.
- **Test**: `sfdx-lwc-jest` è configurato (`jest.config.js`, script npm `test:unit`), ma **non esistono test Jest** nel repo (nessuna cartella `__tests__`). I test Apex esistono e sono ampi (`SurveyServiceTest`, 18 metodi — vedi [05-apex-components.md](05-apex-components.md)).
