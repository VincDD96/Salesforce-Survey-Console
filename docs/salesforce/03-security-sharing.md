# 03 — Modello di sicurezza e sharing

> Fonti: `objects/**` (sharingModel), `permissionsets/*.permissionset-meta.xml`, classi Apex (sharing/FLS)

## 1. Impostazione generale

Il progetto non versiona alcun **profilo**: tutto l'accesso funzionale è concesso tramite **due permission set**, secondo il disegno "Admin/Author vs Utente/Compilatore" del design. L'Apex gira `with sharing` e ogni SOQL usa `WITH SECURITY_ENFORCED`, quindi CRUD/FLS e sharing sono rispettati anche nel percorso server.

## 2. Org-Wide Defaults

| Oggetto                | OWD interno           | OWD esterno       | Note                                                                                                                           |
| ---------------------- | --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Survey__c`            | **Public Read/Write** | Public Read/Write | Configurazione leggibile/scrivibile da tutta l'org (a livello di sharing).                                                     |
| `Question__c`          | **Public Read/Write** | Public Read/Write | Idem.                                                                                                                          |
| `Answer_Option__c`     | Controlled by Parent  | —                 | Segue `Question__c` (master-detail).                                                                                           |
| `Survey_Response__c`   | **Public Read/Write** | Public Read/Write | I **dati di risposta** sono visibili e modificabili, a livello di sharing, da qualsiasi utente interno con i permessi oggetto. |
| `Question_Response__c` | Controlled by Parent  | —                 | Segue `Survey_Response__c` (master-detail).                                                                                    |
| `Survey_Theme__c`      | Public Read/Write     | **Private**       | Nuovo (R13): nato già con OWD esterno Private, senza il residuo Read/Write degli altri oggetti (R7).                           |

**Punto d'attenzione (fattuale).** Con OWD Read/Write su `Survey_Response__c`, la riservatezza delle risposte è affidata unicamente ai permessi oggetto/campo dei permission set: qualunque utente che ottenga (anche da altre fonti) permessi di lettura sull'oggetto vede **tutte** le risposte di **tutti** gli utenti, comprese quelle a testo libero. Anche il permission set `Survey_Respondent` (pensato per i soli compilatori) concede Read sull'oggetto, quindi un rispondente può leggere le risposte altrui via list view/report/API. Il `ReadWrite` come OWD _esterno_ su Survey, Question e Survey_Response è rilevante solo se in futuro venissero attivati utenti community (lo scope dichiarato oggi è solo interno).

**Decisioni prese sugli OWD:**

- **OWD interno Read/Write su `Survey_Response__c`**: scelta confermata _per il momento_ — le risposte non sono trattate come dati riservati. Il punto resta segnato come "da rivalutare" in [07-roadmap.md](07-roadmap.md) qualora la natura dei dati cambiasse.
- **OWD esterni Read/Write** su `Survey__c`, `Question__c` e `Survey_Response__c`: confermati come **residuo di configurazione**, non una scelta in previsione di Experience Cloud. La restrizione è censita come intervento di pulizia in [07-roadmap.md](07-roadmap.md).

## 3. Permission set

Legenda: **C**reate **R**ead **U**pdate **D**elete **V**iewAll **M**odifyAll.

### Survey_Admin — "Survey Admin / Author"

Descrizione (dal metadato): gestione completa di Survey, Question, Answer Option e accesso al tool di authoring; lettura su Response per revisione.

| Oggetto                | Accesso                                   |
| ---------------------- | ----------------------------------------- |
| `Survey__c`            | CRUD + **ViewAll + ModifyAll**            |
| `Question__c`          | CRUD + **ViewAll + ModifyAll**            |
| `Answer_Option__c`     | CRUD + **ViewAll + ModifyAll**            |
| `Survey_Response__c`   | RUD (no Create) + **ViewAll + ModifyAll** |
| `Question_Response__c` | RUD (no Create) + **ViewAll + ModifyAll** |
| `Survey_Theme__c`      | CRUD + **ViewAll + ModifyAll** (R13)      |

- FLS: read+edit su tutti i campi custom rilevanti dei 6 oggetti (inclusi i campi tema e i testi di cornice su `Survey__c`).
- Apex: accesso a `SurveyController`, `SurveyService` **e `SurveyExportController`** (export CSV delle risposte — vedi nota sotto).
- Tab: tutte visibili (6 oggetti + `Survey_Author` + `Survey_Experience`); app `Survey_Console` visibile.
- Il "no Create" sulle Response è coerente con il flusso: le submission nascono solo dal runner/Apex, l'admin le consulta, corregge o elimina.

**Punto d'attenzione (fattuale).** `ViewAllRecords`/`ModifyAllRecords` su tutti e 5 gli oggetti è un permesso ampio ma **scopato ai soli oggetti Survey** (non è "Modify All Data"). Sugli oggetti di configurazione è ridondante rispetto all'OWD Read/Write; sulle Response dà all'admin visibilità totale sulle risposte — coerente con il ruolo di revisore descritto nel metadato, ma da tenere presente se le risposte diventassero dati sensibili.

**Nota su `SurveyExportController`**: l'export CSV (§"Esporta risposte" in [05-apex-components.md](05-apex-components.md)) è volutamente in una classe Apex **separata** da `SurveyController`, perché l'accesso Apex si concede per classe intera e non per singolo metodo — se il metodo fosse finito su `SurveyController`, sarebbe stato automaticamente disponibile anche a `Survey_Respondent` (che ha già accesso a quella classe). Tenerlo in una classe dedicata, con class access concesso solo a `Survey_Admin`, è l'unico modo per far rispettare davvero il vincolo "solo Admin" a livello di codice, indipendentemente dall'OWD Read/Write già presente su `Survey_Response__c`/`Question_Response__c` (§2).

### Survey_Respondent — "Survey Respondent"

Descrizione (dal metadato): utenti finali che compilano e inviano; sola lettura sulla configurazione, create+read sulle risposte.

| Oggetto                | Accesso                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `Survey__c`            | R                                                            |
| `Question__c`          | R                                                            |
| `Answer_Option__c`     | R                                                            |
| `Survey_Response__c`   | **C**R (no edit/delete)                                      |
| `Question_Response__c` | **C**R (no edit/delete)                                      |
| `Survey_Theme__c`      | R (necessario al runner per leggere il tema del survey, R13) |

- FLS: read-only su tutti i campi di configurazione (incluse regex, messaggi di errore, coordinate editor, campi tema e testi di cornice — necessario perché `SurveyService` li interroga con `WITH SECURITY_ENFORCED`, che fallirebbe senza FLS in lettura); read+edit sui campi delle Response (necessario per l'insert alla submission). Il logo del tema è un File: viene reso visibile ai rispondenti impostando la visibility del link a `AllUsers` all'upload (`registerThemeLogo`).
- Apex: accesso al solo `SurveyController` (non a `SurveyService` — irrilevante a runtime perché il Controller è l'unico entry point, ma coerente col principio del minimo privilegio).
- Tab: `Survey_Response__c` e `Question_Response__c` visibili; **nessuna visibilità** dell'app `Survey_Console` né della tab `Survey_Author`.
- "No edit" sulle Response = una submission non è modificabile a posteriori dal rispondente (immutabilità post-invio); resta però la lettura di tutte le Response per via dell'OWD (vedi §2).

L'accesso dei compilatori è governato interamente dal permission set: `Survey_Respondent` viene assegnato direttamente agli utenti interessati (nessun profilo dedicato né automazione di assegnazione).

## 4. Sicurezza a livello di codice

- `SurveyService` e `SurveyController` sono entrambi `with sharing`; tutte le SOQL (incluse quelle sulle StaticResource del tema) usano `WITH SECURITY_ENFORCED`. Non ci sono DML `without sharing` né bypass di FLS.
- Le DML di submission (`insert session` / `insert answerRecords`) rispettano quindi CRUD del rispondente (Create su Response) e sono protette da savepoint/rollback: nessun record orfano in caso di errore parziale.
- L'editor (`surveyAuthor`) non passa da Apex per le scritture: usa **`lightning/uiRecordApi`** (`createRecord`/`updateRecord`/`deleteRecord`), che applica nativamente CRUD/FLS/sharing dell'utente. Un utente con il solo `Survey_Respondent` non potrebbe quindi modificare il grafo nemmeno raggiungendo la pagina dell'editor.
- Il mapping dinamico delle entità (`applyEntityMapping`) accetta dal client nomi campo arbitrari, ma vincola: campo esistente su `Survey_Response__c`, tipo REFERENCE, prefisso Id coerente col target. Non è possibile usarlo per scrivere campi non-lookup. La scrittura del lookup avviene comunque sotto sharing e FLS dell'utente (FLS edit sul campo è richiesta: per campi nuovi va aggiornato il permission set).
- Superficie di rischio residua lato client: le **regex configurate dagli admin** vengono eseguite nel browser del rispondente (`new RegExp(...)`). Il rischio ReDoS è noto e accettato nel design (§5) in quanto le regex sono scritte da admin interni; la mitigazione prevista (validare la regex al salvataggio nell'editor) non è ancora implementata.

## 5. Riepilogo dei punti d'attenzione

| #   | Osservazione                                                                               | Dove |
| --- | ------------------------------------------------------------------------------------------ | ---- |
| 1   | OWD Public Read/Write sui dati di risposta: riservatezza affidata solo ai permessi oggetto | §2   |
| 2   | OWD esterni Read/Write senza uso Experience Cloud dichiarato                               | §2   |
| 3   | View All / Modify All per l'admin su tutti gli oggetti (scopato, ma ampio)                 | §3   |
| 4   | Nessun profilo/muting nel repo: dipendenza da configurazioni org non versionate            | §1   |
| 5   | Regex admin eseguite nel browser senza validazione in authoring                            | §4   |
