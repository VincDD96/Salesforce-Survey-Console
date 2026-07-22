# 06 — Catalogo integrazioni

> Fonti: scansione completa di `force-app/main/default/` (named credentials, external services, remote site, connected app, platform events, external objects) e dei sorgenti Apex/LWC (indicatori di callout).

## 1. Esito della scansione

Il progetto è **completamente self-contained dentro Salesforce**: non esiste alcuna integrazione in uscita o in entrata.

| Tipo                                                                        | Presenza |
| --------------------------------------------------------------------------- | -------- |
| Named Credential / External Credential                                      | Nessuna  |
| External Service                                                            | Nessuno  |
| Remote Site Setting                                                         | Nessuno  |
| Connected App / External Client App                                         | Nessuna  |
| Platform Event / Change Data Capture                                        | Nessuno  |
| External Object                                                             | Nessuno  |
| Callout Apex (`Http`, `HttpRequest`, `WebService`, `@future(callout=true)`) | Nessuno  |
| `fetch`/`XMLHttpRequest` nei LWC                                            | Nessuno  |

Coerente con lo scope del design: "solo pagine interne Salesforce". Anche il theming è interamente su record (`Survey_Theme__c`) e File Salesforce: nessuna risorsa esterna coinvolta.
