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
    public static SurveyService.SubmissionResult submitResponse(String submissionJson) {
        try {
            SurveyService.SubmissionRequest req = (SurveyService.SubmissionRequest)
                JSON.deserialize(submissionJson, SurveyService.SubmissionRequest.class);
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
     * Returns the body of the named StaticResource as text (the LWC parses it as JSON).
     * Done in Apex (rather than fetch('/resource/...')) so callers don't need to
     * construct namespaced URLs and so we can enforce a single read path.
     */
    @AuraEnabled(cacheable=true)
    public static String getThemeJson(String resourceName) {
        if (String.isBlank(resourceName)) {
            return null;
        }
        try {
            List<StaticResource> resources = [
                SELECT Body
                FROM StaticResource
                WHERE Name = :resourceName
                WITH SECURITY_ENFORCED
                LIMIT 1
            ];
            if (resources.isEmpty()) {
                return null;
            }
            return resources[0].Body.toString();
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
