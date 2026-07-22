/**
 * SurveyController — thin LWC-facing facade. All business logic lives in SurveyService.
 *
 * Exposed methods:
 *   - getSurveyByName(String): cacheable, used by the compilation LWC on load.
 *   - submitResponse(String): single-DML submission of a finished survey.
 *   - validateGraph(Id): cycle / orphan detection used by the authoring editor.
 *
 * AuraHandledException is the only exception type that surfaces a clean message to LWC.
 */
public with sharing class SurveyController {
  @AuraEnabled(cacheable=true)
  public static SurveyService.SurveyDTO getSurveyByName(String surveyName) {
    try {
      return SurveyService.loadActiveSurveyByName(surveyName);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled(cacheable=true)
  public static SurveyService.SurveyDTO getSurveyById(Id surveyId) {
    try {
      return SurveyService.loadSurveyById(surveyId);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled
  public static SurveyService.SubmissionResult submitResponse(
    String submissionJson
  ) {
    try {
      SurveyService.SubmissionRequest req = (SurveyService.SubmissionRequest) JSON.deserialize(
        submissionJson,
        SurveyService.SubmissionRequest.class
      );
      return SurveyService.submitResponse(req);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled
  public static SurveyService.GraphValidationResult validateGraph(Id surveyId) {
    try {
      return SurveyService.validateGraph(surveyId);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  /**
   * Post-upload hook of the experience editor: makes the freshly uploaded
   * logo File visible to all internal users so respondents can render it.
   */
  @AuraEnabled
  public static void registerThemeLogo(Id themeId, Id contentDocumentId) {
    try {
      SurveyService.registerThemeLogo(themeId, contentDocumentId);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }
}
