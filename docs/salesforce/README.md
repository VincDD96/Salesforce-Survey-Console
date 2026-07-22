# Documentazione tecnica — progetto Survey

Documentazione generata automaticamente dal codice sorgente del repository (Salesforce DX, `force-app/main/default/`, API 66.0), integrata con il documento di design `docs/design.md`.

**Generata il**: 2026-07-21 · **revisionata il**: 2026-07-21 con le risposte agli open item · **aggiornata il**: 2026-07-21 dopo l'implementazione di R13 (theming su oggetto + editor experience) e R14 (export CSV pivotato delle risposte) · repository non inizializzato su git (nessun riferimento a commit).

## Indice

| Documento                                          | Contenuto                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [01 — Panoramica del progetto](01-overview.md)     | Cos'è il componente Survey, inventario metadati, struttura del repo, attori, limiti tecnici, scostamenti dal design, toolchain                                                                                                                                                 |
| [02 — Modello dati](02-data-model.md)              | ERD, i 5 oggetti custom campo per campo, decisioni di modellazione, semantica di navigazione del grafo                                                                                                                                                                         |
| [03 — Sicurezza e sharing](03-security-sharing.md) | OWD e decisioni prese al riguardo, i 2 permission set, sicurezza a livello di codice, punti d'attenzione                                                                                                                                                                       |
| [04 — Automazioni](04-automation.md)               | Inventario (vuoto per scelta), mappa di dove vive la logica di processo, decisioni prese                                                                                                                                                                                       |
| [05 — Apex, LWC e UI](05-apex-components.md)       | SurveyService/SurveyController/test, surveyRunner, surveyAuthor, temi, app/pagine/tab                                                                                                                                                                                          |
| [06 — Integrazioni](06-integrations.md)            | Catalogo integrazioni (nessuna); CRM Analytics confermato out of scope                                                                                                                                                                                                         |
| [**07 — Roadmap**](07-roadmap.md)                  | **14 interventi** (R1–R12 approvati il 2026-07-21; R3 raffinato con flag di configurazione sul Survey). **R13 completato**: oggetto `Survey_Theme__c` + editor experience con anteprima live. **R14 completato**: export CSV pivotato delle risposte, riservato a Survey Admin |

## Stato degli open item

Tutti i **14 open item** della prima generazione hanno ricevuto risposta (2026-07-21) e sono stati integrati nel testo dei documenti; le risposte sono registrate in `_answers.json` (ledger durevole — non cancellare). Non ci sono `⚠️ TO CONFIRM` aperti.

Le risposte di tipo "da fare" non sono state trattate come risolte ma **censite come interventi in [07-roadmap.md](07-roadmap.md)**, che è il file di lavoro per la prossima discussione (cosa fare, cosa ampliare, con quali priorità).

Per eventuali future domande aperte vale sempre il meccanismo: sotto un marker `⚠️ TO CONFIRM [Q:...]` aggiungere una riga

```
> ✅ RISPOSTA: <la risposta>
```

e chiedere di aggiornare la documentazione.
