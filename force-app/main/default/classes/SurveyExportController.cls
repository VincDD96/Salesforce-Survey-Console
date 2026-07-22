/**
 * SurveyExportController — admin-only facade for exporting survey responses.
 *
 * Kept as its own class (not folded into SurveyController) so its Apex class
 * access can be granted only to Survey_Admin: Salesforce grants Apex access
 * per class, not per method, and Survey_Respondent already has access to
 * SurveyController — this is the only way to keep the export surface
 * Admin-only regardless of that.
 */
public with sharing class SurveyExportController {
  /**
   * Generates the CSV, stores it as a File on the Survey and returns the
   * download URL — the LWC/Quick Action just navigates to it. A raw CSV
   * string can't be handed to a client-side Blob download here: Lightning
   * Web Security rejects that with "Unsupported MIME type".
   */
  @AuraEnabled
  public static String exportResponsesFile(Id surveyId) {
    try {
      return SurveyService.exportResponsesFile(surveyId);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }
}
