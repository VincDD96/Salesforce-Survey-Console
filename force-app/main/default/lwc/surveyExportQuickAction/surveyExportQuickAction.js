import { LightningElement, api } from "lwc";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import exportResponsesFile from "@salesforce/apex/SurveyExportController.exportResponsesFile";

/**
 * Headless Lightning Web Component Quick Action on Survey__c: no screen, the
 * platform calls invoke() as soon as the action fires. Opens the generated
 * export File's download URL in a new tab — reuses the same Apex path as the
 * "Esporta risposte" button in Survey Author (SurveyExportController is the
 * only place the access is actually enforced: Survey_Admin only).
 */
export default class SurveyExportQuickAction extends LightningElement {
  @api recordId;

  async invoke() {
    try {
      const url = await exportResponsesFile({ surveyId: this.recordId });
      window.open(url, "_blank");
    } catch (e) {
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Errore",
          message: this.errorMessage(e),
          variant: "error"
        })
      );
    }
  }

  errorMessage(e) {
    if (!e) return "Errore sconosciuto";
    if (e.body && e.body.message) return e.body.message;
    if (e.message) return e.message;
    return String(e);
  }
}
