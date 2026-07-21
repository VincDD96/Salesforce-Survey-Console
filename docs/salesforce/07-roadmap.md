# 07 — Roadmap

> File di lavoro: censisce gli interventi decisi durante la revisione della documentazione e le decisioni prese in discussione. **Aggiornato il 2026-07-21**: tutti gli interventi R1–R12 sono stati **approvati**; R3 è stato raffinato (flag sul Survey); aggiunto **R13** (customizzazione dell'experience: oggetto di configurazione estetica + editor point-and-click). Priorità e sequenza di implementazione non sono ancora state definite.

## 1. Interventi approvati

### R1 — Validation rule su `Survey__c.Start_Question__c` ✅ approvato

- **Origine**: risposta a `Q:data-model:Survey__c.Start_Question__c:business-rule`. La description del campo cita già una validation rule mai creata.
- **Stato attuale**: l'obbligatorietà dello start per i survey Active è garantita solo dall'eccezione runtime in `SurveyService.loadActiveSurveyByName`; dati caricati via API la aggirano.
- **Intervento**: creare la validation rule su `Survey__c` che impedisca `Status__c = Active` con `Start_Question__c` vuoto.
- Il blocco esteso alla validità del grafo è coperto da R8 (una validation rule non può invocare `validateGraph`).

### R2 — Automazione per `Survey__c.Version__c` ✅ approvato

- **Origine**: risposta a `Q:data-model:Survey__c.Version__c:business-rule`.
- **Stato attuale**: campo testuale libero, aggiornamento manuale, nessuna convenzione; fotografato su ogni `Question_Response__c` alla submission.
- **Intervento**: introdurre un'automazione che gestisca la versione.
- **Da definire in implementazione**: evento che incrementa la versione (ogni modifica a domande/opzioni? solo al passaggio Draft → Active?), formato (progressivo numerico, `v{n}`, data) e tecnologia (record-triggered flow vs trigger Apex).

### R3 — Controllo risposte multiple con flag sul Survey ✅ approvato (raffinato 2026-07-21)

- **Origine**: risposta a `Q:automation:SurveyService:double-submission`; raffinato in discussione.
- **Decisione**: non un blocco fisso, ma un **flag di configurazione su `Survey__c`** (es. `Allow_Multiple_Responses__c`, checkbox) con cui chi progetta il questionario decide se consentire più compilazioni o una sola.
- **Comportamento atteso**:
  - flag attivo → comportamento odierno (compilazioni illimitate);
  - flag disattivo → una sola submission ammessa; il controllo va applicato sia in `SurveyService.submitResponse` (enforcement server) sia nel runner al load (UX: non proporre un questionario già compilato).
- **Da definire in implementazione**: valore di default del flag; criterio di unicità quando il flag è disattivo — per utente (`Submitted_By__c` + `Survey__c`) e/o per entità collegata (stesso `Account__c`/`Contact__c` del mapping dinamico); messaggio/schermata per il caso "già compilato".

### R4 — Validazione delle regex in fase di authoring (anti-ReDoS) ✅ approvato

- **Origine**: design §5 e description di `Question__c.Validation_Regex__c`; confermato in revisione.
- **Stato attuale**: l'editor salva `Validation_Regex__c` / `Free_Text_Regex__c` senza verificarle; il runner compila la regex nel browser del rispondente; una regex catastrofica può bloccarlo.
- **Intervento**: validare la regex al salvataggio nell'editor (sintassi + guardia contro pattern catastrofici). La ri-validazione server-side delle risposte è coperta da R9.

### R5 — Anteprima del questionario nell'editor ✅ approvato

- **Origine**: design §9; confermato in revisione.
- **Intervento**: modalità anteprima dall'editor (candidata naturale: riuso di `surveyRunner` in modal senza submission; `SurveyController.getSurveyById` carica già i Draft).
- **Da definire in implementazione**: anteprima read-only o con navigazione completa; bypass del vincolo `Status__c = Active`. Sinergia con l'anteprima live dell'editor temi (R13).

### R6 — Localizzazione / traduzioni ✅ approvato

- **Origine**: design §13.5; confermato in revisione.
- **Stato attuale**: label di fallback hardcoded in italiano in `surveyRunner`; testi di cornice nel tema (una lingua per tema); testi di domande/opzioni monolingua sul record.
- **Da definire in implementazione**: Custom Label + Translation Workbench per le label fisse; strategia per i contenuti (temi per lingua, campi tradotti, oggetto di traduzione dedicato). Da coordinare con R13, che sposta i testi di cornice su oggetto.

### R7 — Pulizia OWD esterni ✅ approvato

- **Origine**: risposta a `Q:security:Survey__c:external-owd` ("sono un residuo").
- **Intervento**: restringere `externalSharingModel` (tipicamente a Private) su `Survey__c`, `Question__c`, `Survey_Response__c` nei metadati oggetto.

### R8 — Blocco automatico dell'attivazione per grafi invalidi ✅ approvato

- **Stato attuale**: `validateGraph` (cicli/orfani/start) gira solo su richiesta manuale nell'editor; un grafo invalido può diventare Active.
- **Intervento**: enforcement al passaggio `Status__c → Active` (richiede trigger/flow che invochi la logica Apex di validazione; complementare a R1).

### R9 — Ri-validazione server-side delle risposte ✅ approvato

- **Stato attuale**: required e regex sono verificati solo nel client (`surveyRunner.validateAnswer`); `submitResponse` verifica solo il required.
- **Intervento**: rieseguire in `SurveyService.submitResponse` le validazioni di regex (domanda e free-text delle opzioni), così una submission costruita ad arte non può salvare valori invalidi.

### R10 — Test Jest per i LWC ✅ approvato

- **Stato attuale**: toolchain `sfdx-lwc-jest` configurata, nessun test presente; con R13 i componenti da coprire aumentano.
- **Intervento**: suite Jest per `surveyRunner` (navigazione, validazione, tema) e `surveyAuthor` (layout, salvataggi), poi per i componenti nuovi.

### R11 — Fase 2 dell'editor in React ✅ approvato

- **Origine**: design §9 — quando Multi-Framework sarà GA in produzione (target citato: Spring 2027).
- **Intervento**: migrazione dell'editor a grafo a React; nessuna azione a breve, resta in roadmap come orizzonte.

### R12 — Protezione runtime anti-loop nel runner ✅ approvato

- **Intervento**: guardia sul numero di passi di navigazione nel runner (difesa in profondità complementare a R8, se un grafo con cicli arrivasse comunque in produzione).

### R13 — Customizzazione dell'experience: oggetto di configurazione + theme editor ✅ nuovo (2026-07-21)

- **Origine**: discussione del 2026-07-21.
- **Stato attuale**: l'estetica è gestita interamente da **static resource JSON** (`Survey_Theme_Default`, `Survey_Theme_Christmas`) referenziate per nome da `Survey__c.Theme_Static_Resource__c` e lette via `SurveyController.getThemeJson`; creare o modificare un tema richiede il deploy di una static resource (attività da sviluppatore, non da admin).
- **Intervento deciso**: sostituire questo meccanismo con:
  1. **un nuovo oggetto custom** (es. `Survey_Theme__c`) che contiene le configurazioni estetiche, con lookup da `Survey__c` (il riferimento esplicito per nome viene sostituito da una relazione vera; il riuso di un tema su più survey resta garantito dal lookup);
  2. **un editor point-and-click** (LWC, stessa filosofia del `surveyAuthor`) per configurare le impostazioni del tema, idealmente con **anteprima live** del rendering.
- **Decisioni di design prese (2026-07-21):**
  - **Forma dei dati: campi tipizzati** su `Survey_Theme__c` (un campo per impostazione — colori, radius, font, flag layout), niente JSON opaco. Bozza campi: `Primary_Color__c`, `Background_Color__c`, `Surface_Color__c`, `Text_Color__c`, `Muted_Color__c`, `Error_Color__c` (Text hex con validazione formato), `Border_Radius__c` (Number, px), `Font_Family__c` (Text), `Show_Progress_Bar__c` (Checkbox, default on). `Survey__c` acquisisce il lookup `Theme__c → Survey_Theme__c`, che sostituirà `Theme_Static_Resource__c`.
  - **Perimetro: i testi di cornice vanno su `Survey__c`** (per-survey), non sul tema: bozza campi `Display_Title__c`, `Intro_Text__c`, `Closing_Message__c`, `Next_Label__c`, `Back_Label__c`, `Submit_Label__c` (fallback attuali: Name, `Description__c`, stringhe di default). Il tema resta puramente estetico e riusabile su più survey; questo semplifica anche R6 (tradurre testi per-survey, non per-tema).
  - **Modello dell'editor**: un unico editor dell'experience, scoperto per survey: si seleziona il survey, si sceglie/assegna il **tema** (condivisibile tra survey), si modificano le impostazioni estetiche del tema e i **testi** del survey, il tutto con **anteprima live** del questionario (riuso di `surveyRunner` in modalità demo, senza submission — sinergia con R5). L'editor deve rendere evidente che modificare i token di un tema condiviso impatta *tutti* i survey che lo usano.
  - **Logo: file caricato** (ContentDocument collegato al record `Survey_Theme__c`), upload direttamente dall'editor (`lightning-file-upload`); il runner lo renderizza via URL di download della ContentVersion. Da curare la condivisione del file perché sia visibile ai rispondenti.
  - **Sicurezza** (delegata, impostazione scelta): `Survey_Theme__c` con CRUD+ViewAll/ModifyAll per `Survey_Admin` e Read per `Survey_Respondent` (necessario per le query `WITH SECURITY_ENFORCED` del runner); FLS su tutti i campi nuovi (edit admin / read respondent, inclusi i nuovi campi testo su `Survey__c`); tab oggetto `Survey_Theme__c` + tab per l'editor experience nella `Survey_Console`; visibilità dei file logo estesa a tutti gli utenti interni.
  - **Migrazione**: i due temi esistenti (`Survey_Theme_Default`, `Survey_Theme_Christmas`) vengono migrati subito a record; `Theme_Static_Resource__c` e `getThemeJson` restano come fallback solo transitorio nel runner e vengono poi dismessi (un solo percorso di lettura a regime).

## 2. Da rivalutare (nessun intervento deciso)

| Punto | Decisione attuale | Quando rivalutare |
| --- | --- | --- |
| OWD interno **Public Read/Write** su `Survey_Response__c` (i rispondenti possono leggere le risposte altrui via report/API) | "Per il momento lasciamo così" — le risposte non sono trattate come dati riservati | Se i questionari iniziassero a raccogliere dati sensibili/personali, o all'ingresso di utenti esterni |
