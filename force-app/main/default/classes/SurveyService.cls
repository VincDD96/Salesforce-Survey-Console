/**
 * SurveyService — business logic for loading a Survey graph, validating it,
 * and persisting a submission as a single DML transaction with snapshot fields.
 *
 * Runs `with sharing`: respondents only see records they have access to.
 */
public with sharing class SurveyService {
  public class SurveyException extends Exception {
  }

  @TestVisible
  private static final Integer MAX_GRAPH_NODES = 500;

  // Governors for exportResponsesCsv: bulk-safe against the 50,000-row SOQL
  // limit even though both queries run in the same synchronous transaction.
  @TestVisible
  private static final Integer MAX_EXPORT_RESPONSES = 5000;
  @TestVisible
  private static final Integer MAX_EXPORT_ANSWER_ROWS = 40000;

  // ---------------------------------------------------------------------
  // DTOs returned to LWC. All @AuraEnabled fields are serialized.
  // ---------------------------------------------------------------------

  public class SurveyDTO {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String name;
    @AuraEnabled
    public String description;
    @AuraEnabled
    public String status;
    @AuraEnabled
    public String version;
    @AuraEnabled
    public Id startQuestionId;
    @AuraEnabled
    public List<QuestionDTO> questions;
    // Frame texts (per-survey; theme stays purely aesthetic).
    @AuraEnabled
    public String displayTitle;
    @AuraEnabled
    public String introText;
    @AuraEnabled
    public String closingMessage;
    @AuraEnabled
    public String nextLabel;
    @AuraEnabled
    public String backLabel;
    @AuraEnabled
    public String submitLabel;
    // Record-based theme; null when the survey has no Theme__c
    // (the runner then uses its built-in defaults).
    @AuraEnabled
    public ThemeDTO theme;
  }

  public class ThemeDTO {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String name;
    @AuraEnabled
    public String primaryColor;
    @AuraEnabled
    public String backgroundColor;
    @AuraEnabled
    public String surfaceColor;
    @AuraEnabled
    public String textColor;
    @AuraEnabled
    public String mutedColor;
    @AuraEnabled
    public String errorColor;
    @AuraEnabled
    public Decimal borderRadius;
    @AuraEnabled
    public String fontFamily;
    @AuraEnabled
    public Boolean showProgressBar;
    @AuraEnabled
    public String logoUrl;
    @AuraEnabled
    public Decimal logoHeight;
    // How many surveys reference this theme — the experience editor warns
    // that edits to a shared theme affect all of them.
    @AuraEnabled
    public Integer usageCount;
  }

  public class QuestionDTO {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String text;
    @AuraEnabled
    public String type;
    @AuraEnabled
    public Boolean isRequired;
    @AuraEnabled
    public Decimal orderHint;
    @AuraEnabled
    public String validationRegex;
    @AuraEnabled
    public String validationErrorMessage;
    @AuraEnabled
    public String placeholder;
    @AuraEnabled
    public Id defaultNextQuestionId;
    @AuraEnabled
    public Decimal editorX;
    @AuraEnabled
    public Decimal editorY;
    @AuraEnabled
    public List<OptionDTO> options;
  }

  public class OptionDTO {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String text;
    @AuraEnabled
    public Decimal orderHint;
    @AuraEnabled
    public Id nextQuestionId;
    @AuraEnabled
    public Boolean allowsFreeText;
    @AuraEnabled
    public String freeTextRegex;
    @AuraEnabled
    public String freeTextErrorMessage;
  }

  public class SubmissionRequest {
    @AuraEnabled
    public Id surveyId;
    @AuraEnabled
    public String entityMappingJson;
    @AuraEnabled
    public List<AnswerInput> answers;
  }

  public class AnswerInput {
    @AuraEnabled
    public Id questionId;
    @AuraEnabled
    public List<Id> selectedOptionIds;
    @AuraEnabled
    public String freeTextValue;
  }

  public class SubmissionResult {
    @AuraEnabled
    public Id surveyResponseId;
    @AuraEnabled
    public Integer questionResponsesCreated;
  }

  public class GraphValidationResult {
    @AuraEnabled
    public Boolean isValid;
    @AuraEnabled
    public List<String> errors;
    @AuraEnabled
    public List<List<Id>> cycles;
  }

  // ---------------------------------------------------------------------
  // Load: by API name (the Survey "name" passed by the LWC container).
  // ---------------------------------------------------------------------

  public static SurveyDTO loadActiveSurveyByName(String surveyName) {
    if (String.isBlank(surveyName)) {
      throw new SurveyException('Survey name is required');
    }

    List<Survey__c> surveys = [
      SELECT
        Id,
        Name,
        Description__c,
        Status__c,
        Version__c,
        Start_Question__c,
        Display_Title__c,
        Intro_Text__c,
        Closing_Message__c,
        Next_Label__c,
        Back_Label__c,
        Submit_Label__c,
        Theme__c,
        Theme__r.Name,
        Theme__r.Primary_Color__c,
        Theme__r.Background_Color__c,
        Theme__r.Surface_Color__c,
        Theme__r.Text_Color__c,
        Theme__r.Muted_Color__c,
        Theme__r.Error_Color__c,
        Theme__r.Border_Radius__c,
        Theme__r.Font_Family__c,
        Theme__r.Show_Progress_Bar__c,
        Theme__r.Logo_Height__c
      FROM Survey__c
      WHERE Name = :surveyName
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];
    if (surveys.isEmpty()) {
      throw new SurveyException('Survey not found: ' + surveyName);
    }
    Survey__c survey = surveys[0];
    if (survey.Status__c != 'Active') {
      throw new SurveyException('Survey is not Active: ' + surveyName);
    }
    if (survey.Start_Question__c == null) {
      throw new SurveyException('Survey has no Start_Question__c defined');
    }

    return buildSurveyDTO(survey);
  }

  public static SurveyDTO loadSurveyById(Id surveyId) {
    if (surveyId == null) {
      throw new SurveyException('Survey Id is required');
    }
    List<Survey__c> surveys = [
      SELECT
        Id,
        Name,
        Description__c,
        Status__c,
        Version__c,
        Start_Question__c,
        Display_Title__c,
        Intro_Text__c,
        Closing_Message__c,
        Next_Label__c,
        Back_Label__c,
        Submit_Label__c,
        Theme__c,
        Theme__r.Name,
        Theme__r.Primary_Color__c,
        Theme__r.Background_Color__c,
        Theme__r.Surface_Color__c,
        Theme__r.Text_Color__c,
        Theme__r.Muted_Color__c,
        Theme__r.Error_Color__c,
        Theme__r.Border_Radius__c,
        Theme__r.Font_Family__c,
        Theme__r.Show_Progress_Bar__c,
        Theme__r.Logo_Height__c
      FROM Survey__c
      WHERE Id = :surveyId
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];
    if (surveys.isEmpty()) {
      throw new SurveyException('Survey not found: ' + surveyId);
    }
    return buildSurveyDTO(surveys[0]);
  }

  private static SurveyDTO buildSurveyDTO(Survey__c survey) {
    List<Question__c> questions = [
      SELECT
        Id,
        Question_Text__c,
        Type__c,
        Is_Required__c,
        Order__c,
        Validation_Regex__c,
        Validation_Error_Message__c,
        Placeholder__c,
        Default_Next_Question__c,
        Editor_X__c,
        Editor_Y__c
      FROM Question__c
      WHERE Survey__c = :survey.Id
      WITH SECURITY_ENFORCED
      ORDER BY Order__c NULLS LAST, CreatedDate ASC
      LIMIT :MAX_GRAPH_NODES
    ];
    if (questions.size() >= MAX_GRAPH_NODES) {
      throw new SurveyException(
        'Survey has too many questions (limit ' +
          MAX_GRAPH_NODES +
          '). Split it.'
      );
    }

    List<Answer_Option__c> options = [
      SELECT
        Id,
        Question__c,
        Option_Text__c,
        Order__c,
        Next_Question__c,
        Allows_Free_Text__c,
        Free_Text_Regex__c,
        Free_Text_Error_Message__c
      FROM Answer_Option__c
      WHERE Question__c IN :questions
      WITH SECURITY_ENFORCED
      ORDER BY Order__c NULLS LAST, CreatedDate ASC
    ];

    Map<Id, List<OptionDTO>> optionsByQuestion = new Map<Id, List<OptionDTO>>();
    for (Answer_Option__c opt : options) {
      OptionDTO dto = new OptionDTO();
      dto.id = opt.Id;
      dto.text = opt.Option_Text__c;
      dto.orderHint = opt.Order__c;
      dto.nextQuestionId = opt.Next_Question__c;
      dto.allowsFreeText = opt.Allows_Free_Text__c;
      dto.freeTextRegex = opt.Free_Text_Regex__c;
      dto.freeTextErrorMessage = opt.Free_Text_Error_Message__c;
      if (!optionsByQuestion.containsKey(opt.Question__c)) {
        optionsByQuestion.put(opt.Question__c, new List<OptionDTO>());
      }
      optionsByQuestion.get(opt.Question__c).add(dto);
    }

    SurveyDTO out = new SurveyDTO();
    out.id = survey.Id;
    out.name = survey.Name;
    out.description = survey.Description__c;
    out.status = survey.Status__c;
    out.version = survey.Version__c;
    out.startQuestionId = survey.Start_Question__c;
    out.displayTitle = survey.Display_Title__c;
    out.introText = survey.Intro_Text__c;
    out.closingMessage = survey.Closing_Message__c;
    out.nextLabel = survey.Next_Label__c;
    out.backLabel = survey.Back_Label__c;
    out.submitLabel = survey.Submit_Label__c;
    out.theme = buildThemeDTO(survey);
    out.questions = new List<QuestionDTO>();

    for (Question__c q : questions) {
      QuestionDTO qd = new QuestionDTO();
      qd.id = q.Id;
      qd.text = q.Question_Text__c;
      qd.type = q.Type__c;
      qd.isRequired = q.Is_Required__c;
      qd.orderHint = q.Order__c;
      qd.validationRegex = q.Validation_Regex__c;
      qd.validationErrorMessage = q.Validation_Error_Message__c;
      qd.placeholder = q.Placeholder__c;
      qd.defaultNextQuestionId = q.Default_Next_Question__c;
      qd.editorX = q.Editor_X__c;
      qd.editorY = q.Editor_Y__c;
      qd.options = optionsByQuestion.containsKey(q.Id)
        ? optionsByQuestion.get(q.Id)
        : new List<OptionDTO>();
      out.questions.add(qd);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Theme: record-based aesthetic configuration. The logo is the newest
  // File linked to the theme record; served via the shepherd download URL.
  // ---------------------------------------------------------------------

  private static ThemeDTO buildThemeDTO(Survey__c survey) {
    if (survey.Theme__c == null) {
      return null;
    }
    ThemeDTO t = new ThemeDTO();
    t.id = survey.Theme__c;
    t.name = survey.Theme__r.Name;
    t.primaryColor = survey.Theme__r.Primary_Color__c;
    t.backgroundColor = survey.Theme__r.Background_Color__c;
    t.surfaceColor = survey.Theme__r.Surface_Color__c;
    t.textColor = survey.Theme__r.Text_Color__c;
    t.mutedColor = survey.Theme__r.Muted_Color__c;
    t.errorColor = survey.Theme__r.Error_Color__c;
    t.borderRadius = survey.Theme__r.Border_Radius__c;
    t.fontFamily = survey.Theme__r.Font_Family__c;
    t.showProgressBar = survey.Theme__r.Show_Progress_Bar__c;
    t.logoHeight = survey.Theme__r.Logo_Height__c;
    t.logoUrl = latestLogoUrl(survey.Theme__c);
    t.usageCount = [
      SELECT COUNT()
      FROM Survey__c
      WHERE Theme__c = :survey.Theme__c
    ];
    return t;
  }

  private static String latestLogoUrl(Id themeId) {
    List<ContentDocumentLink> links = [
      SELECT ContentDocument.LatestPublishedVersionId
      FROM ContentDocumentLink
      WHERE LinkedEntityId = :themeId
      WITH SECURITY_ENFORCED
      ORDER BY SystemModstamp DESC
      LIMIT 1
    ];
    if (links.isEmpty()) {
      return null;
    }
    return '/sfc/servlet.shepherd/version/download/' +
      links[0].ContentDocument.LatestPublishedVersionId;
  }

  /**
   * Called by the experience editor right after a logo upload: marks the
   * File link as visible to all internal users so respondents can render it.
   */
  public static void registerThemeLogo(Id themeId, Id contentDocumentId) {
    if (themeId == null || contentDocumentId == null) {
      throw new SurveyException('themeId and contentDocumentId are required');
    }
    List<ContentDocumentLink> links = [
      SELECT Id, Visibility
      FROM ContentDocumentLink
      WHERE LinkedEntityId = :themeId AND ContentDocumentId = :contentDocumentId
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];
    if (links.isEmpty()) {
      throw new SurveyException('The File is not linked to the theme record');
    }
    if (links[0].Visibility != 'AllUsers') {
      links[0].Visibility = 'AllUsers';
      update links[0];
    }
  }

  // ---------------------------------------------------------------------
  // Submit: single DML, snapshot question/answer/survey text, populate
  // dynamic entity-mapping lookups from JSON.
  // ---------------------------------------------------------------------

  public static SubmissionResult submitResponse(SubmissionRequest request) {
    if (request == null || request.surveyId == null) {
      throw new SurveyException('SubmissionRequest.surveyId is required');
    }
    if (request.answers == null || request.answers.isEmpty()) {
      throw new SurveyException('SubmissionRequest.answers cannot be empty');
    }

    // Load the survey graph fresh so we snapshot the *current* text at write time.
    SurveyDTO dto = loadSurveyById(request.surveyId);
    Map<Id, QuestionDTO> questionById = new Map<Id, QuestionDTO>();
    for (QuestionDTO q : dto.questions) {
      questionById.put(q.id, q);
    }
    Map<Id, OptionDTO> optionById = new Map<Id, OptionDTO>();
    for (QuestionDTO q : dto.questions) {
      for (OptionDTO o : q.options) {
        optionById.put(o.id, o);
      }
    }

    // Build Survey_Response__c with the dynamic-entity mapping populated from JSON.
    Survey_Response__c session = new Survey_Response__c(
      Survey__c = request.surveyId,
      Completed_Date__c = System.now(),
      Submitted_By__c = UserInfo.getUserId()
    );
    applyEntityMapping(session, request.entityMappingJson);

    // Build Question_Response__c records (one per selected option for multi-choice).
    List<Question_Response__c> answerRecords = new List<Question_Response__c>();
    for (AnswerInput input : request.answers) {
      QuestionDTO q = questionById.get(input.questionId);
      if (q == null) {
        throw new SurveyException(
          'AnswerInput references unknown question ' + input.questionId
        );
      }
      answerRecords.addAll(buildAnswerRecords(dto, q, input, optionById));
    }

    // Single DML — insert session and then children in one savepoint scope.
    Savepoint sp = Database.setSavepoint();
    try {
      insert session;
      for (Question_Response__c qr : answerRecords) {
        qr.Survey_Response__c = session.Id;
      }
      if (!answerRecords.isEmpty()) {
        insert answerRecords;
      }
    } catch (Exception e) {
      Database.rollback(sp);
      throw new SurveyException('Submission failed: ' + e.getMessage());
    }

    SubmissionResult result = new SubmissionResult();
    result.surveyResponseId = session.Id;
    result.questionResponsesCreated = answerRecords.size();
    return result;
  }

  private static List<Question_Response__c> buildAnswerRecords(
    SurveyDTO survey,
    QuestionDTO q,
    AnswerInput input,
    Map<Id, OptionDTO> optionById
  ) {
    List<Question_Response__c> records = new List<Question_Response__c>();

    Boolean hasSelections =
      input.selectedOptionIds != null && !input.selectedOptionIds.isEmpty();
    Boolean hasFreeText = String.isNotBlank(input.freeTextValue);

    if (hasSelections) {
      for (Id optionId : input.selectedOptionIds) {
        OptionDTO opt = optionById.get(optionId);
        if (opt == null) {
          throw new SurveyException(
            'AnswerInput references unknown option ' +
              optionId +
              ' for question ' +
              q.id
          );
        }
        Question_Response__c qr = newAnswerRecord(survey, q);
        qr.Selected_Option__c = optionId;
        qr.Answer_Text_Snapshot__c = opt.text;
        if (opt.allowsFreeText && hasFreeText) {
          qr.Free_Text_Value__c = input.freeTextValue;
        }
        records.add(qr);
      }
    } else if (hasFreeText) {
      Question_Response__c qr = newAnswerRecord(survey, q);
      qr.Free_Text_Value__c = input.freeTextValue;
      qr.Answer_Text_Snapshot__c = input.freeTextValue;
      records.add(qr);
    } else if (q.isRequired) {
      throw new SurveyException(
        'Question ' + q.id + ' is required but no answer was provided'
      );
    } else {
      Question_Response__c qr = newAnswerRecord(survey, q);
      records.add(qr);
    }

    return records;
  }

  private static Question_Response__c newAnswerRecord(
    SurveyDTO survey,
    QuestionDTO q
  ) {
    Question_Response__c qr = new Question_Response__c();
    qr.Question__c = q.id;
    qr.Question_Text_Snapshot__c = q.text;
    qr.Survey_Name_Snapshot__c = survey.name;
    qr.Survey_Version_Snapshot__c = survey.version;
    return qr;
  }

  // ---------------------------------------------------------------------
  // Dynamic entity mapping: JSON keys must match real lookup fields on
  // Survey_Response__c and the Id type must match the lookup target.
  // ---------------------------------------------------------------------

  @TestVisible
  private static void applyEntityMapping(
    Survey_Response__c session,
    String mappingJson
  ) {
    if (String.isBlank(mappingJson)) {
      return;
    }
    Map<String, Object> mapping;
    try {
      mapping = (Map<String, Object>) JSON.deserializeUntyped(mappingJson);
    } catch (Exception e) {
      throw new SurveyException(
        'Invalid entity-mapping JSON: ' + e.getMessage()
      );
    }

    Map<String, Schema.SObjectField> fieldMap = Survey_Response__c.SObjectType.getDescribe()
      .fields.getMap();

    for (String fieldName : mapping.keySet()) {
      Object raw = mapping.get(fieldName);
      if (raw == null) {
        continue;
      }
      Schema.SObjectField token = fieldMap.get(fieldName.toLowerCase());
      if (token == null) {
        throw new SurveyException(
          'Entity mapping references unknown field "' +
            fieldName +
            '" on Survey_Response__c'
        );
      }
      Schema.DescribeFieldResult df = token.getDescribe();
      if (df.getType() != Schema.DisplayType.REFERENCE) {
        throw new SurveyException(
          'Entity mapping field "' + fieldName + '" is not a lookup'
        );
      }
      Id value;
      try {
        value = (Id) raw;
      } catch (Exception e) {
        throw new SurveyException(
          'Entity mapping value for "' + fieldName + '" is not a valid Id'
        );
      }
      // Cross-check the Id type with the lookup target.
      Schema.SObjectType targetType = df.getReferenceTo()[0];
      String idPrefix = String.valueOf(value).substring(0, 3);
      String targetPrefix = targetType.getDescribe().getKeyPrefix();
      if (targetPrefix != null && targetPrefix != idPrefix) {
        throw new SurveyException(
          'Entity mapping value for "' +
            fieldName +
            '" does not match the lookup target type'
        );
      }
      session.put(token, value);
    }
  }

  // ---------------------------------------------------------------------
  // Graph validation — for the authoring tool: detects cycles via DFS
  // coloring (white/gray/black) and reports the first cycle found per
  // start node. Also reports orphan nodes (unreachable from start).
  // ---------------------------------------------------------------------

  public static GraphValidationResult validateGraph(Id surveyId) {
    SurveyDTO dto = loadSurveyById(surveyId);
    GraphValidationResult result = new GraphValidationResult();
    result.isValid = true;
    result.errors = new List<String>();
    result.cycles = new List<List<Id>>();

    if (dto.startQuestionId == null) {
      result.isValid = false;
      result.errors.add('Start_Question__c is not set on the Survey.');
    }

    Map<Id, List<Id>> adjacency = new Map<Id, List<Id>>();
    for (QuestionDTO q : dto.questions) {
      List<Id> outgoing = new List<Id>();
      for (OptionDTO o : q.options) {
        if (o.nextQuestionId != null) {
          outgoing.add(o.nextQuestionId);
        }
      }
      if (q.defaultNextQuestionId != null) {
        outgoing.add(q.defaultNextQuestionId);
      }
      adjacency.put(q.id, outgoing);
    }

    // Cycle detection from every node so disconnected sub-graphs are also checked.
    Map<Id, String> color = new Map<Id, String>();
    for (Id qid : adjacency.keySet()) {
      color.put(qid, 'WHITE');
    }
    for (Id qid : adjacency.keySet()) {
      if (color.get(qid) == 'WHITE') {
        List<Id> stack = new List<Id>();
        List<Id> cycle = dfsCycle(qid, adjacency, color, stack);
        if (cycle != null) {
          result.isValid = false;
          result.cycles.add(cycle);
          result.errors.add('Cycle detected: ' + cycle);
        }
      }
    }

    // Orphan detection: questions unreachable from the start node.
    if (dto.startQuestionId != null) {
      Set<Id> reachable = new Set<Id>();
      List<Id> toVisit = new List<Id>{ dto.startQuestionId };
      while (!toVisit.isEmpty()) {
        Id current = toVisit.remove(toVisit.size() - 1);
        if (reachable.contains(current)) {
          continue;
        }
        reachable.add(current);
        List<Id> neighbors = adjacency.get(current);
        if (neighbors != null) {
          toVisit.addAll(neighbors);
        }
      }
      for (Id qid : adjacency.keySet()) {
        if (!reachable.contains(qid)) {
          result.isValid = false;
          result.errors.add('Orphan question (unreachable from start): ' + qid);
        }
      }
    }

    return result;
  }

  private static List<Id> dfsCycle(
    Id node,
    Map<Id, List<Id>> adjacency,
    Map<Id, String> color,
    List<Id> stack
  ) {
    color.put(node, 'GRAY');
    stack.add(node);
    List<Id> neighbors = adjacency.get(node);
    if (neighbors != null) {
      for (Id next : neighbors) {
        if (!color.containsKey(next)) {
          continue; // edge to a node not in this survey — ignore defensively
        }
        String c = color.get(next);
        if (c == 'GRAY') {
          Integer idx = stack.indexOf(next);
          List<Id> cycle = new List<Id>();
          for (Integer i = idx; i < stack.size(); i++) {
            cycle.add(stack[i]);
          }
          cycle.add(next);
          return cycle;
        } else if (c == 'WHITE') {
          List<Id> found = dfsCycle(next, adjacency, color, stack);
          if (found != null) {
            return found;
          }
        }
      }
    }
    color.put(node, 'BLACK');
    stack.remove(stack.size() - 1);
    return null;
  }

  // ---------------------------------------------------------------------
  // Export: pivoted CSV — one row per Survey_Response__c (respondent), one
  // column per Question__c, using the same Answer_Text_Snapshot__c the
  // report/analytics denormalization is built on (never live option text).
  // Admin-only surface (see SurveyExportController for why).
  // ---------------------------------------------------------------------

  public static String exportResponsesCsv(Id surveyId) {
    if (surveyId == null) {
      throw new SurveyException('Survey Id is required');
    }
    List<Survey__c> surveys = [
      SELECT Id
      FROM Survey__c
      WHERE Id = :surveyId
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];
    if (surveys.isEmpty()) {
      throw new SurveyException('Survey not found: ' + surveyId);
    }

    List<Question__c> questions = [
      SELECT Id, Question_Text__c
      FROM Question__c
      WHERE Survey__c = :surveyId
      WITH SECURITY_ENFORCED
      ORDER BY Order__c NULLS LAST, CreatedDate ASC
      LIMIT :MAX_GRAPH_NODES
    ];
    if (questions.size() >= MAX_GRAPH_NODES) {
      throw new SurveyException(
        'Survey has too many questions (limit ' +
          MAX_GRAPH_NODES +
          '). Split it.'
      );
    }

    Integer responseCount = [
      SELECT COUNT()
      FROM Survey_Response__c
      WHERE Survey__c = :surveyId
      WITH SECURITY_ENFORCED
    ];
    if (responseCount > MAX_EXPORT_RESPONSES) {
      throw new SurveyException(
        'Export has too many responses (' +
          responseCount +
          ', limit ' +
          MAX_EXPORT_RESPONSES +
          '). Narrow the export or contact an administrator.'
      );
    }

    Integer answerRowCount = [
      SELECT COUNT()
      FROM Question_Response__c
      WHERE Survey_Response__r.Survey__c = :surveyId
      WITH SECURITY_ENFORCED
    ];
    if (answerRowCount > MAX_EXPORT_ANSWER_ROWS) {
      throw new SurveyException(
        'Export has too many answer rows (' +
          answerRowCount +
          ', limit ' +
          MAX_EXPORT_ANSWER_ROWS +
          '). Narrow the export or contact an administrator.'
      );
    }

    List<Survey_Response__c> responses = [
      SELECT Id, Name, Completed_Date__c, Submitted_By__r.Name
      FROM Survey_Response__c
      WHERE Survey__c = :surveyId
      WITH SECURITY_ENFORCED
      ORDER BY Completed_Date__c ASC NULLS LAST
      LIMIT :MAX_EXPORT_RESPONSES
    ];

    // Group answers by (Survey_Response, Question); multi-choice questions
    // carry multiple rows for the same pair, one per selected option.
    Map<Id, Map<Id, List<Question_Response__c>>> answersByResponseAndQuestion = new Map<Id, Map<Id, List<Question_Response__c>>>();
    if (!responses.isEmpty()) {
      for (Question_Response__c qr : [
        SELECT
          Survey_Response__c,
          Question__c,
          Selected_Option__c,
          Answer_Text_Snapshot__c,
          Free_Text_Value__c
        FROM Question_Response__c
        WHERE Survey_Response__c IN :responses
        WITH SECURITY_ENFORCED
        ORDER BY CreatedDate ASC, Id ASC
      ]) {
        Map<Id, List<Question_Response__c>> byQuestion = answersByResponseAndQuestion.get(
          qr.Survey_Response__c
        );
        if (byQuestion == null) {
          byQuestion = new Map<Id, List<Question_Response__c>>();
          answersByResponseAndQuestion.put(qr.Survey_Response__c, byQuestion);
        }
        List<Question_Response__c> forQuestion = byQuestion.get(qr.Question__c);
        if (forQuestion == null) {
          forQuestion = new List<Question_Response__c>();
          byQuestion.put(qr.Question__c, forQuestion);
        }
        forQuestion.add(qr);
      }
    }

    List<String> headerCells = new List<String>{
      'Survey Response',
      'Completed Date',
      'Submitted By'
    };
    for (Question__c q : questions) {
      headerCells.add(q.Question_Text__c);
    }

    List<String> lines = new List<String>{ toCsvLine(headerCells) };
    for (Survey_Response__c sr : responses) {
      List<String> cells = new List<String>{
        sr.Name,
        sr.Completed_Date__c == null ? '' : sr.Completed_Date__c.format(),
        sr.Submitted_By__r == null ? '' : sr.Submitted_By__r.Name
      };
      Map<Id, List<Question_Response__c>> byQuestion = answersByResponseAndQuestion.get(
        sr.Id
      );
      for (Question__c q : questions) {
        List<Question_Response__c> forQuestion = byQuestion == null
          ? null
          : byQuestion.get(q.Id);
        cells.add(formatAnswerCell(forQuestion));
      }
      lines.add(toCsvLine(cells));
    }

    return String.join(lines, '\r\n');
  }

  /**
   * Same export as exportResponsesCsv, but persisted as a Salesforce File
   * (ContentVersion) linked to the Survey and returned as a download URL —
   * used by the LWC/Quick Action instead of a client-side Blob download,
   * which Lightning Web Security blocks ("Unsupported MIME type") for
   * dynamically-typed Blobs. Also leaves an audit trail of past exports in
   * the Survey's Files related list.
   */
  public static String exportResponsesFile(Id surveyId) {
    String csv = exportResponsesCsv(surveyId);

    List<Survey__c> surveys = [
      SELECT Name
      FROM Survey__c
      WHERE Id = :surveyId
      WITH SECURITY_ENFORCED
      LIMIT 1
    ];
    String surveyName = surveys.isEmpty() ? 'Survey' : surveys[0].Name;
    String fileNameBase = sanitizeForFileName(surveyName);
    String stamp = Datetime.now().format('yyyyMMdd_HHmm');

    ContentVersion cv = new ContentVersion(
      Title = surveyName + ' - Responses - ' + Datetime.now().format(),
      PathOnClient = fileNameBase + '_responses_' + stamp + '.csv',
      VersionData = Blob.valueOf(csv)
    );
    insert cv;

    Id contentDocumentId = [
      SELECT ContentDocumentId
      FROM ContentVersion
      WHERE Id = :cv.Id
      WITH SECURITY_ENFORCED
    ]
    .ContentDocumentId;

    insert new ContentDocumentLink(
      LinkedEntityId = surveyId,
      ContentDocumentId = contentDocumentId,
      ShareType = 'V',
      Visibility = 'AllUsers'
    );

    return '/sfc/servlet.shepherd/version/download/' + cv.Id;
  }

  private static String sanitizeForFileName(String raw) {
    String base = String.isBlank(raw) ? 'Survey' : raw;
    String safe = base.replaceAll('[^a-zA-Z0-9]+', '_')
      .replaceAll('^_+|_+$', '');
    return String.isBlank(safe) ? 'Survey' : safe;
  }

  /**
   * One answer cell: the snapshot text of every matching Question_Response
   * (joined with "; " for multi-choice), with the free-text companion of an
   * "Allows_Free_Text__c" option appended in parentheses when present.
   */
  private static String formatAnswerCell(List<Question_Response__c> answers) {
    if (answers == null || answers.isEmpty()) {
      return '';
    }
    List<String> parts = new List<String>();
    for (Question_Response__c qr : answers) {
      String part = qr.Answer_Text_Snapshot__c;
      if (
        qr.Selected_Option__c != null &&
        String.isNotBlank(qr.Free_Text_Value__c)
      ) {
        part =
          (String.isBlank(part) ? '' : part + ' ') +
          '(' +
          qr.Free_Text_Value__c +
          ')';
      }
      if (String.isNotBlank(part)) {
        parts.add(part);
      }
    }
    return String.join(parts, '; ');
  }

  private static String toCsvLine(List<String> cells) {
    List<String> escaped = new List<String>();
    for (String cell : cells) {
      escaped.add(csvField(cell));
    }
    return String.join(escaped, ',');
  }

  /** Always-quote CSV escaping (RFC 4180-ish): safe for commas, quotes and newlines in any cell. */
  private static String csvField(String value) {
    String v = value == null ? '' : value;
    v = v.replace('"', '""');
    return '"' + v + '"';
  }
}
