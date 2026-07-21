@IsTest
private class SurveyServiceTest {

    /**
     * Builds a small linear survey:
     *
     *   start (Q1, SingleChoice) -- option A --> Q2 (FreeText) --default--> Q3 (terminal)
     *                            -- option B --> (terminal)
     *
     * Returns a map: {survey, q1, q2, q3, optA, optB}.
     */
    private static Map<String, SObject> seedLinearSurvey(String status) {
        Survey__c s = new Survey__c(
            Name = 'TS-' + String.valueOf(Crypto.getRandomInteger()),
            Description__c = 'test',
            Status__c = status,
            Version__c = 'v1'
        );
        insert s;

        Question__c q1 = new Question__c(
            Survey__c = s.Id,
            Question_Text__c = 'Q1?',
            Type__c = 'SingleChoice',
            Order__c = 1,
            Is_Required__c = true
        );
        Question__c q2 = new Question__c(
            Survey__c = s.Id,
            Question_Text__c = 'Q2?',
            Type__c = 'FreeText',
            Order__c = 2,
            Is_Required__c = false,
            Validation_Regex__c = '^\\d{2}$',
            Validation_Error_Message__c = 'Must be two digits'
        );
        Question__c q3 = new Question__c(
            Survey__c = s.Id,
            Question_Text__c = 'Q3 (terminal)?',
            Type__c = 'SingleChoice',
            Order__c = 3,
            Is_Required__c = false
        );
        insert new List<Question__c>{ q1, q2, q3 };

        Answer_Option__c optA = new Answer_Option__c(
            Question__c = q1.Id,
            Option_Text__c = 'A goes to Q2',
            Order__c = 1,
            Next_Question__c = q2.Id
        );
        Answer_Option__c optB = new Answer_Option__c(
            Question__c = q1.Id,
            Option_Text__c = 'B terminates',
            Order__c = 2
        );
        insert new List<Answer_Option__c>{ optA, optB };

        s.Start_Question__c = q1.Id;
        update s;

        q2.Default_Next_Question__c = q3.Id;
        update q2;

        Map<String, SObject> bag = new Map<String, SObject>();
        bag.put('survey', s);
        bag.put('q1', q1);
        bag.put('q2', q2);
        bag.put('q3', q3);
        bag.put('optA', optA);
        bag.put('optB', optB);
        return bag;
    }

    // ---------------- loadActiveSurveyByName ----------------

    @IsTest
    static void loadActive_returnsGraph() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');

        Test.startTest();
        SurveyService.SurveyDTO dto = SurveyService.loadActiveSurveyByName(s.Name);
        Test.stopTest();

        System.assertEquals(s.Id, dto.id);
        System.assertEquals(3, dto.questions.size());
        System.assertEquals(seed.get('q1').Id, dto.startQuestionId);
        SurveyService.QuestionDTO q1Dto = dto.questions[0];
        System.assertEquals(2, q1Dto.options.size());
    }

    @IsTest
    static void loadActive_nonActive_throws() {
        Map<String, SObject> seed = seedLinearSurvey('Draft');
        Survey__c s = (Survey__c) seed.get('survey');

        try {
            SurveyService.loadActiveSurveyByName(s.Name);
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('not Active'));
        }
    }

    @IsTest
    static void loadActive_missingStart_throws() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        s.Start_Question__c = null;
        update s;

        try {
            SurveyService.loadActiveSurveyByName(s.Name);
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('Start_Question'));
        }
    }

    @IsTest
    static void loadActive_blankName_throws() {
        try {
            SurveyService.loadActiveSurveyByName('');
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('required'));
        }
    }

    // ---------------- submitResponse ----------------

    @IsTest
    static void submit_singleChoice_snapshotsAndSavesOnce() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');
        Answer_Option__c optA = (Answer_Option__c) seed.get('optA');

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = q1.Id;
        a.selectedOptionIds = new List<Id>{ optA.Id };
        req.answers = new List<SurveyService.AnswerInput>{ a };

        Test.startTest();
        SurveyService.SubmissionResult result = SurveyService.submitResponse(req);
        Test.stopTest();

        System.assertNotEquals(null, result.surveyResponseId);
        System.assertEquals(1, result.questionResponsesCreated);

        Survey_Response__c session = [
            SELECT Id, Survey__c, Completed_Date__c, Submitted_By__c
            FROM Survey_Response__c WHERE Id = :result.surveyResponseId
        ];
        System.assertEquals(s.Id, session.Survey__c);
        System.assertNotEquals(null, session.Completed_Date__c);
        System.assertEquals(UserInfo.getUserId(), session.Submitted_By__c);

        List<Question_Response__c> answers = [
            SELECT Question__c, Selected_Option__c,
                   Question_Text_Snapshot__c, Answer_Text_Snapshot__c,
                   Survey_Name_Snapshot__c, Survey_Version_Snapshot__c
            FROM Question_Response__c WHERE Survey_Response__c = :session.Id
        ];
        System.assertEquals(1, answers.size());
        Question_Response__c qr = answers[0];
        System.assertEquals('Q1?', qr.Question_Text_Snapshot__c);
        System.assertEquals('A goes to Q2', qr.Answer_Text_Snapshot__c);
        System.assertEquals(s.Name, qr.Survey_Name_Snapshot__c);
        System.assertEquals('v1', qr.Survey_Version_Snapshot__c);
    }

    @IsTest
    static void submit_multiChoice_oneRecordPerOption() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');
        q1.Type__c = 'MultiChoice';
        update q1;
        Answer_Option__c optA = (Answer_Option__c) seed.get('optA');
        Answer_Option__c optB = (Answer_Option__c) seed.get('optB');

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = q1.Id;
        a.selectedOptionIds = new List<Id>{ optA.Id, optB.Id };
        req.answers = new List<SurveyService.AnswerInput>{ a };

        SurveyService.SubmissionResult result = SurveyService.submitResponse(req);
        System.assertEquals(2, result.questionResponsesCreated);

        List<Question_Response__c> answers = [
            SELECT Selected_Option__c, Answer_Text_Snapshot__c
            FROM Question_Response__c
            WHERE Survey_Response__c = :result.surveyResponseId
            ORDER BY Answer_Text_Snapshot__c
        ];
        System.assertEquals(2, answers.size());
        System.assertEquals('A goes to Q2', answers[0].Answer_Text_Snapshot__c);
        System.assertEquals('B terminates', answers[1].Answer_Text_Snapshot__c);
    }

    @IsTest
    static void submit_requiredWithoutAnswer_throws() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = q1.Id;
        a.selectedOptionIds = new List<Id>(); // empty, but q1 is required
        req.answers = new List<SurveyService.AnswerInput>{ a };

        try {
            SurveyService.submitResponse(req);
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('required'));
        }
    }

    @IsTest
    static void submit_unknownQuestion_throws() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = s.Id; // wrong type — Survey Id where Question Id expected
        a.selectedOptionIds = new List<Id>();
        req.answers = new List<SurveyService.AnswerInput>{ a };

        try {
            SurveyService.submitResponse(req);
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('unknown question'));
        }
    }

    // ---------------- Entity-mapping JSON ----------------

    @IsTest
    static void submit_entityMapping_populatesAccount() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');
        Answer_Option__c optA = (Answer_Option__c) seed.get('optA');

        Account acct = new Account(Name = 'Acme');
        insert acct;

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        req.entityMappingJson = '{"Account__c":"' + acct.Id + '"}';
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = q1.Id;
        a.selectedOptionIds = new List<Id>{ optA.Id };
        req.answers = new List<SurveyService.AnswerInput>{ a };

        SurveyService.SubmissionResult result = SurveyService.submitResponse(req);

        Survey_Response__c session = [
            SELECT Account__c FROM Survey_Response__c WHERE Id = :result.surveyResponseId
        ];
        System.assertEquals(acct.Id, session.Account__c);
    }

    @IsTest
    static void submit_entityMapping_unknownField_throws() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');
        Answer_Option__c optA = (Answer_Option__c) seed.get('optA');

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        req.entityMappingJson = '{"Bogus__c":"001000000000000"}';
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = q1.Id;
        a.selectedOptionIds = new List<Id>{ optA.Id };
        req.answers = new List<SurveyService.AnswerInput>{ a };

        try {
            SurveyService.submitResponse(req);
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('unknown field'));
        }
    }

    @IsTest
    static void submit_entityMapping_wrongIdType_throws() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');
        Answer_Option__c optA = (Answer_Option__c) seed.get('optA');

        Contact c = new Contact(LastName = 'Test');
        insert c;

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        // Account__c lookup field, but we pass a Contact Id.
        req.entityMappingJson = '{"Account__c":"' + c.Id + '"}';
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = q1.Id;
        a.selectedOptionIds = new List<Id>{ optA.Id };
        req.answers = new List<SurveyService.AnswerInput>{ a };

        try {
            SurveyService.submitResponse(req);
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('does not match'));
        }
    }

    @IsTest
    static void submit_entityMapping_nonLookupField_throws() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');
        Answer_Option__c optA = (Answer_Option__c) seed.get('optA');

        SurveyService.SubmissionRequest req = new SurveyService.SubmissionRequest();
        req.surveyId = s.Id;
        // Completed_Date__c is a DateTime, not a lookup.
        req.entityMappingJson = '{"Completed_Date__c":"001000000000000"}';
        SurveyService.AnswerInput a = new SurveyService.AnswerInput();
        a.questionId = q1.Id;
        a.selectedOptionIds = new List<Id>{ optA.Id };
        req.answers = new List<SurveyService.AnswerInput>{ a };

        try {
            SurveyService.submitResponse(req);
            System.assert(false, 'Expected SurveyException');
        } catch (SurveyService.SurveyException e) {
            System.assert(e.getMessage().contains('not a lookup'));
        }
    }

    // ---------------- Graph validation ----------------

    @IsTest
    static void validate_cleanGraph_isValid() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');

        SurveyService.GraphValidationResult res = SurveyService.validateGraph(s.Id);

        System.assert(res.isValid, 'Expected valid graph: ' + res.errors);
        System.assert(res.cycles.isEmpty());
    }

    @IsTest
    static void validate_cycleDetected() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q3 = (Question__c) seed.get('q3');

        // Make Q3 route back to Q1: build a cycle.
        Answer_Option__c cycleOpt = new Answer_Option__c(
            Question__c = q3.Id,
            Option_Text__c = 'Back to start',
            Order__c = 1,
            Next_Question__c = ((Question__c) seed.get('q1')).Id
        );
        insert cycleOpt;

        SurveyService.GraphValidationResult res = SurveyService.validateGraph(s.Id);

        System.assert(!res.isValid);
        System.assert(!res.cycles.isEmpty(), 'Expected at least one cycle');
    }

    @IsTest
    static void validate_orphanDetected() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');

        // Add an orphan question unreachable from start.
        Question__c orphan = new Question__c(
            Survey__c = s.Id,
            Question_Text__c = 'Floating',
            Type__c = 'FreeText',
            Order__c = 99,
            Is_Required__c = false
        );
        insert orphan;

        SurveyService.GraphValidationResult res = SurveyService.validateGraph(s.Id);

        System.assert(!res.isValid);
        Boolean hasOrphanError = false;
        for (String err : res.errors) {
            if (err.contains('Orphan')) hasOrphanError = true;
        }
        System.assert(hasOrphanError, 'Expected orphan error in: ' + res.errors);
    }

    // ---------------- Controller smoke ----------------

    @IsTest
    static void controller_getSurveyByName_works() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        SurveyService.SurveyDTO dto = SurveyController.getSurveyByName(s.Name);
        System.assertEquals(s.Id, dto.id);
    }

    @IsTest
    static void controller_submitResponse_works() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        Question__c q1 = (Question__c) seed.get('q1');
        Answer_Option__c optA = (Answer_Option__c) seed.get('optA');

        Map<String, Object> payload = new Map<String, Object>{
            'surveyId' => s.Id,
            'entityMappingJson' => null,
            'answers' => new List<Object>{
                new Map<String, Object>{
                    'questionId' => q1.Id,
                    'selectedOptionIds' => new List<Id>{ optA.Id },
                    'freeTextValue' => null
                }
            }
        };
        SurveyService.SubmissionResult result =
            SurveyController.submitResponse(JSON.serialize(payload));
        System.assertNotEquals(null, result.surveyResponseId);
    }

    @IsTest
    static void controller_validateGraph_works() {
        Map<String, SObject> seed = seedLinearSurvey('Active');
        Survey__c s = (Survey__c) seed.get('survey');
        SurveyService.GraphValidationResult res = SurveyController.validateGraph(s.Id);
        System.assert(res.isValid);
    }
}
