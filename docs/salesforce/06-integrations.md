# 06 — Catalogo integrazioni

> Fonti: scansione completa di `force-app/main/default/` (named credentials, external services, remote site, connected app, platform events, external objects) e dei sorgenti Apex/LWC (indicatori di callout).

## 1. Esito della scansione

Il progetto è **completamente self-contained dentro Salesforce**: non esiste alcuna integrazione in uscita o in entrata.

| Tipo | Presenza |
| --- | --- |
| Named Credential / External Credential | Nessuna |
| External Service | Nessuno |
| Remote Site Setting | Nessuno |
| Connected App / External Client App | Nessuna |
| Platform Event / Change Data Capture | Nessuno |
| External Object | Nessuno |
| Callout Apex (`Http`, `HttpRequest`, `WebService`, `@future(callout=true)`) | Nessuno |
| `fetch`/`XMLHttpRequest` nei LWC | Nessuno |

Coerente con lo scope del design: "solo pagine interne Salesforce". L'unico accesso a risorse "esterne al modello dati" è la lettura delle **StaticResource dei temi**, fatta comunque via SOQL in Apex (`SurveyController.getThemeJson`) e non via URL — scelta documentata nel codice per evitare la costruzione di URL namespaced e centralizzare il punto di lettura.

## 2. Punti di contatto con l'esterno previsti ma fuori repo

- **CRM Analytics**: il design (§11) indica che il reporting sarà fatto su CRM Analytics leggendo i `Question_Response__c` denormalizzati (snapshot). Nel repo non c'è alcun asset Analytics (dataset, recipe, dashboard).
- **`theme.logoUrl`**: il JSON di tema prevede una chiave `logoUrl` che il runner renderizza come `<img src>`. Nei due temi versionati è `null`; se in futuro puntasse a un URL esterno, l'immagine sarebbe caricata dal browser dell'utente (nessuna implicazione server-side, ma è l'unico punto in cui un contenuto esterno potrebbe entrare nella UI).

Confermato: gli asset CRM Analytics sono **out of scope per questo progetto** — il repo si limita a produrre i dati denormalizzati; il reporting è responsabilità di altri.
