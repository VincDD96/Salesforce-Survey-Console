import { LightningElement, api, track } from "lwc";
import getSurveyByName from "@salesforce/apex/SurveyController.getSurveyByName";
import getSurveyById from "@salesforce/apex/SurveyController.getSurveyById";
import submitResponse from "@salesforce/apex/SurveyController.submitResponse";

const FREE_TEXT_TYPES = new Set(["FreeText", "Scale", "Date"]);

export default class SurveyRunner extends LightningElement {
  @api surveyName;
  @api entityMapping;
  /**
   * On a Record Page: auto-populated by Lightning App Builder (no config
   * needed — standard @api recordId behavior). In a Flow or when composed
   * inside another LWC, the caller must bind/pass it explicitly. Combined
   * with entityMappingField to build the mapping without hardcoding an Id
   * or relying on merge-field syntax in a property panel.
   */
  @api recordId;
  /** API name of the Survey_Response__c lookup field to populate with recordId, e.g. "Account__c". */
  @api entityMappingField;
  /** Preview support (experience editor / authoring): load by Id, any status. */
  @api surveyId;
  /** When true, the final submit is skipped — the closing screen is shown without DML. */
  @api previewMode = false;

  @track loading = true;
  @track fatalError;
  @track validationError;
  @track isSubmitting = false;
  @track currentQuestionId;
  @track history = [];

  /** Backing fields for the read-only @api outputs below (Flow reads via the getters). */
  _isCompleted = false;
  _surveyResponseId;

  /**
   * Output for Flow (read after the screen advances) and for a parent LWC
   * that queries this property directly. Prefer the `surveycompleted` event
   * for parent LWCs — it doesn't require polling/querying the child.
   */
  @api get isCompleted() {
    return this._isCompleted;
  }

  /** Output for Flow: the created Survey_Response__c Id, null in preview mode. */
  @api get surveyResponseId() {
    return this._surveyResponseId;
  }

  survey;
  questionsById = new Map();
  answers = new Map();
  theme = {};

  connectedCallback() {
    this.loadSurvey();
  }

  async loadSurvey() {
    try {
      const survey = this.surveyId
        ? await getSurveyById({ surveyId: this.surveyId })
        : await getSurveyByName({ surveyName: this.surveyName });
      this.survey = survey;
      this.questionsById = new Map(survey.questions.map((q) => [q.id, q]));
      this.currentQuestionId = survey.startQuestionId;
      this.theme = this.resolveTheme(survey);
      this.applyTheme();
    } catch (e) {
      this.fatalError = this.errorMessage(e);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Reloads the survey (graph, texts and theme) keeping, when possible, the
   * respondent's position and answers. Used by the experience editor to
   * refresh the live preview after each saved change.
   */
  @api
  async refresh() {
    const previousQuestionId = this.currentQuestionId;
    this.fatalError = undefined;
    try {
      const survey = this.surveyId
        ? await getSurveyById({ surveyId: this.surveyId })
        : await getSurveyByName({ surveyName: this.surveyName });
      this.survey = survey;
      this.questionsById = new Map(survey.questions.map((q) => [q.id, q]));
      this.currentQuestionId =
        previousQuestionId && this.questionsById.has(previousQuestionId)
          ? previousQuestionId
          : survey.startQuestionId;
      this.theme = this.resolveTheme(survey);
      this.applyTheme();
    } catch (e) {
      this.fatalError = this.errorMessage(e);
    }
  }

  /**
   * Normalizes the record-based theme (Survey__c.Theme__c) into the token
   * shape consumed by the getters. No theme = empty (component defaults).
   */
  resolveTheme(survey) {
    if (!survey.theme) {
      return {};
    }
    const t = survey.theme;
    const tokens = {};
    if (t.primaryColor) tokens.primary = t.primaryColor;
    if (t.backgroundColor) tokens.background = t.backgroundColor;
    if (t.surfaceColor) tokens.surface = t.surfaceColor;
    if (t.textColor) tokens.text = t.textColor;
    if (t.mutedColor) tokens.muted = t.mutedColor;
    if (t.errorColor) tokens.error = t.errorColor;
    if (t.borderRadius != null) tokens.radius = `${t.borderRadius}px`;
    if (t.fontFamily) tokens.fontFamily = t.fontFamily;
    if (t.logoHeight != null) tokens.logoHeight = `${t.logoHeight}px`;
    return {
      tokens,
      logoUrl: t.logoUrl || null,
      layout: { showProgressBar: t.showProgressBar !== false }
    };
  }

  renderedCallback() {
    // Reapply theme on every render in case the host re-attached.
    if (Object.keys(this.theme || {}).length) {
      this.applyTheme();
    }
  }

  applyTheme() {
    const tokens = (this.theme && this.theme.tokens) || {};
    const host = this.template.host;
    if (!host) return;
    const mapping = {
      primary: "--survey-primary",
      background: "--survey-bg",
      surface: "--survey-surface",
      text: "--survey-text",
      muted: "--survey-muted",
      error: "--survey-error",
      radius: "--survey-radius",
      fontFamily: "--survey-font",
      logoHeight: "--survey-logo-height"
    };
    Object.keys(mapping).forEach((key) => {
      if (tokens[key]) {
        host.style.setProperty(mapping[key], tokens[key]);
      } else {
        // Clear stale values so live-preview edits that remove a token
        // fall back to the component defaults.
        host.style.removeProperty(mapping[key]);
      }
    });
  }

  // ---------------- Computed view-model ----------------

  get currentQuestion() {
    return this.currentQuestionId
      ? this.questionsById.get(this.currentQuestionId)
      : null;
  }

  get currentAnswer() {
    const q = this.currentQuestion;
    if (!q) return null;
    return (
      this.answers.get(q.id) || { selectedOptionIds: [], freeTextValue: "" }
    );
  }

  get progressPercent() {
    if (!this.survey || !this.survey.questions.length) return 0;
    const total = this.survey.questions.length;
    const seen = this.history.length + 1;
    return Math.min(100, Math.round((seen / total) * 100));
  }

  get showProgressBar() {
    const flag =
      this.theme && this.theme.layout && this.theme.layout.showProgressBar;
    return flag !== false; // default on
  }

  // Frame texts: Survey record fields first, then legacy theme JSON, then defaults.

  get title() {
    return (
      (this.survey && this.survey.displayTitle) ||
      (this.theme && this.theme.title) ||
      (this.survey && this.survey.name) ||
      ""
    );
  }

  get intro() {
    return (
      (this.survey && this.survey.introText) ||
      (this.theme && this.theme.intro) ||
      (this.survey && this.survey.description) ||
      ""
    );
  }

  get logoUrl() {
    return this.theme && this.theme.logoUrl;
  }

  get closingMessage() {
    return (
      (this.survey && this.survey.closingMessage) ||
      (this.theme && this.theme.closingMessage) ||
      "Grazie per aver completato il questionario."
    );
  }

  get nextLabel() {
    return (
      (this.survey && this.survey.nextLabel) || this.labelFor("next", "Avanti")
    );
  }
  get backLabel() {
    return (
      (this.survey && this.survey.backLabel) ||
      this.labelFor("back", "Indietro")
    );
  }
  get submitLabel() {
    return (
      (this.survey && this.survey.submitLabel) ||
      this.labelFor("submit", "Invia")
    );
  }

  labelFor(key, fallback) {
    return (
      (this.theme && this.theme.labels && this.theme.labels[key]) || fallback
    );
  }

  get canGoBack() {
    return this.history.length > 0 && !this.isCompleted;
  }

  get cantGoBack() {
    return !this.canGoBack;
  }

  get progressStyle() {
    return `width: ${this.progressPercent}%;`;
  }

  get isLastQuestion() {
    // Structural check: the question is "last" only if NO outgoing edge
    // can ever route the user further. Computing it from the current
    // answer (the old behavior) made the button flip to "Submit" before
    // the user picked anything, letting them submit prematurely.
    const q = this.currentQuestion;
    if (!q) return true;
    if (q.defaultNextQuestionId) return false;
    for (const opt of q.options || []) {
      if (opt.nextQuestionId) return false;
    }
    return true;
  }

  get questionView() {
    const q = this.currentQuestion;
    if (!q) return null;
    const answer = this.currentAnswer;
    const selected = new Set(answer.selectedOptionIds || []);
    return {
      ...q,
      isSingleChoice: q.type === "SingleChoice",
      isMultiChoice: q.type === "MultiChoice",
      isFreeText: q.type === "FreeText",
      isScale: q.type === "Scale",
      isDate: q.type === "Date",
      usesFreeTextInput: FREE_TEXT_TYPES.has(q.type),
      freeTextValue: answer.freeTextValue || "",
      options: (q.options || []).map((o) => ({
        ...o,
        checked: selected.has(o.id),
        showFreeText: selected.has(o.id) && o.allowsFreeText,
        inputType: q.type === "MultiChoice" ? "checkbox" : "radio",
        inputName: `q-${q.id}`,
        optionFreeTextValue:
          selected.has(o.id) && o.allowsFreeText
            ? answer.freeTextValue || ""
            : ""
      }))
    };
  }

  // ---------------- Event handlers ----------------

  handleOptionToggle(event) {
    const optionId = event.target.dataset.optionId;
    const q = this.currentQuestion;
    if (!q) return;
    const answer = this.cloneAnswer(q.id);

    if (q.type === "SingleChoice") {
      answer.selectedOptionIds = [optionId];
      answer.freeTextValue = ""; // reset any prior "Other" text
    } else {
      const set = new Set(answer.selectedOptionIds || []);
      if (set.has(optionId)) {
        set.delete(optionId);
      } else {
        set.add(optionId);
      }
      answer.selectedOptionIds = [...set];
    }
    this.answers.set(q.id, answer);
    this.validationError = null;
    // Force re-render of computed getters.
    this.currentQuestionId = q.id;
  }

  handleFreeTextChange(event) {
    const q = this.currentQuestion;
    if (!q) return;
    const answer = this.cloneAnswer(q.id);
    answer.freeTextValue = event.target.value;
    this.answers.set(q.id, answer);
    this.validationError = null;
  }

  handleNext() {
    const q = this.currentQuestion;
    if (!q) return;
    const error = this.validateAnswer(q);
    if (error) {
      this.validationError = error;
      return;
    }
    const nextId = this.computeNextQuestionId();
    if (nextId === null) {
      // Terminal: no more questions, ready to submit.
      this.handleSubmit();
      return;
    }
    this.history.push(q.id);
    this.currentQuestionId = nextId;
    this.validationError = null;
  }

  handleBack() {
    if (!this.canGoBack) return;
    this.validationError = null;
    this.currentQuestionId = this.history.pop();
  }

  async handleSubmit() {
    const q = this.currentQuestion;
    if (q) {
      const error = this.validateAnswer(q);
      if (error) {
        this.validationError = error;
        return;
      }
    }
    if (this.previewMode) {
      // Preview: no DML, just show the closing screen.
      this._surveyResponseId = null;
      this._isCompleted = true;
      this.notifyCompleted(true);
      return;
    }
    this.isSubmitting = true;
    try {
      const payload = {
        surveyId: this.survey.id,
        entityMappingJson: this.buildEntityMappingJson(),
        answers: [...this.answers.entries()].map(([questionId, a]) => ({
          questionId,
          selectedOptionIds: a.selectedOptionIds || [],
          freeTextValue: a.freeTextValue || null
        }))
      };
      const result = await submitResponse({
        submissionJson: JSON.stringify(payload)
      });
      this._surveyResponseId = result && result.surveyResponseId;
      this._isCompleted = true;
      this.notifyCompleted(false);
    } catch (e) {
      this.fatalError = this.errorMessage(e);
    } finally {
      this.isSubmitting = false;
    }
  }

  /**
   * Notifies a parent LWC that the survey was completed. Flow doesn't listen
   * to DOM events — it reads the isCompleted/surveyResponseId @api properties
   * after the screen advances, so no extra wiring is needed on that side.
   */
  notifyCompleted(preview) {
    this.dispatchEvent(
      new CustomEvent("surveycompleted", {
        detail: { surveyResponseId: this.surveyResponseId, preview }
      })
    );
  }

  /**
   * Merges the manual entityMapping JSON (if any) with a {entityMappingField: recordId}
   * pair when both are set — recordId is auto-injected by App Builder on Record Pages,
   * so admins configure only the target field name, no Id typing/merge-field syntax needed.
   */
  buildEntityMappingJson() {
    if (!this.recordId || !this.entityMappingField) {
      return this.entityMapping || null;
    }
    let mapping = {};
    if (this.entityMapping) {
      try {
        mapping = JSON.parse(this.entityMapping) || {};
      } catch {
        // Malformed manual JSON — pass it through unchanged so Apex raises its
        // own "Invalid entity-mapping JSON" error instead of us masking the typo.
        return this.entityMapping;
      }
    }
    mapping[this.entityMappingField] = this.recordId;
    return JSON.stringify(mapping);
  }

  // ---------------- Validation & navigation ----------------

  validateAnswer(q) {
    const answer = this.answers.get(q.id);
    const hasSelection =
      answer && answer.selectedOptionIds && answer.selectedOptionIds.length > 0;
    const hasFreeText =
      answer && answer.freeTextValue && answer.freeTextValue.trim();

    if (q.isRequired && !hasSelection && !hasFreeText) {
      return "Questa domanda è obbligatoria.";
    }
    if (FREE_TEXT_TYPES.has(q.type) && hasFreeText && q.validationRegex) {
      try {
        const re = new RegExp(q.validationRegex);
        if (!re.test(answer.freeTextValue)) {
          return q.validationErrorMessage || "Il valore inserito non è valido.";
        }
      } catch {
        return "Regex di validazione non valida (admin error).";
      }
    }
    // Free-text companion validation for selected options with Allows_Free_Text.
    if (hasSelection) {
      for (const optId of answer.selectedOptionIds) {
        const opt = q.options.find((o) => o.id === optId);
        if (!opt || !opt.allowsFreeText) continue;
        if (!hasFreeText && opt.allowsFreeText) {
          return "Specifica il testo libero per l'opzione selezionata.";
        }
        if (opt.freeTextRegex) {
          try {
            const re = new RegExp(opt.freeTextRegex);
            if (!re.test(answer.freeTextValue)) {
              return (
                opt.freeTextErrorMessage || "Il testo libero non è valido."
              );
            }
          } catch {
            return "Regex di validazione non valida (admin error).";
          }
        }
      }
    }
    return null;
  }

  computeNextQuestionId() {
    const q = this.currentQuestion;
    if (!q) return null;
    const answer = this.answers.get(q.id);
    const selectedIds = (answer && answer.selectedOptionIds) || [];

    if (selectedIds.length === 0) {
      return q.defaultNextQuestionId || null;
    }
    if (selectedIds.length === 1) {
      const opt = q.options.find((o) => o.id === selectedIds[0]);
      return opt ? opt.nextQuestionId || null : q.defaultNextQuestionId || null;
    }
    // Multi-choice with 2+ selections.
    const targets = selectedIds
      .map((id) => q.options.find((o) => o.id === id))
      .filter((o) => o)
      .map((o) => o.nextQuestionId || null);
    const unique = [...new Set(targets)];
    if (unique.length === 1) {
      return unique[0];
    }
    return q.defaultNextQuestionId || null;
  }

  cloneAnswer(questionId) {
    const existing = this.answers.get(questionId) || {
      selectedOptionIds: [],
      freeTextValue: ""
    };
    return {
      selectedOptionIds: [...(existing.selectedOptionIds || [])],
      freeTextValue: existing.freeTextValue || ""
    };
  }

  errorMessage(e) {
    if (!e) return "Errore sconosciuto";
    if (e.body && e.body.message) return e.body.message;
    if (e.message) return e.message;
    return String(e);
  }
}
