import { LightningElement, api, track } from 'lwc';
import getSurveyByName from '@salesforce/apex/SurveyController.getSurveyByName';
import getThemeJson from '@salesforce/apex/SurveyController.getThemeJson';
import submitResponse from '@salesforce/apex/SurveyController.submitResponse';

const FREE_TEXT_TYPES = new Set(['FreeText', 'Scale', 'Date']);

export default class SurveyRunner extends LightningElement {
    @api surveyName;
    @api entityMapping;

    @track loading = true;
    @track fatalError;
    @track validationError;
    @track isSubmitting = false;
    @track isCompleted = false;
    @track currentQuestionId;
    @track history = [];

    survey;
    questionsById = new Map();
    answers = new Map();
    theme = {};

    connectedCallback() {
        this.loadSurvey();
    }

    async loadSurvey() {
        try {
            const survey = await getSurveyByName({ surveyName: this.surveyName });
            this.survey = survey;
            this.questionsById = new Map(survey.questions.map((q) => [q.id, q]));
            this.currentQuestionId = survey.startQuestionId;
            if (survey.themeStaticResource) {
                const raw = await getThemeJson({ resourceName: survey.themeStaticResource });
                if (raw) {
                    try {
                        this.theme = JSON.parse(raw);
                    } catch (e) {
                        // Tema malformato non è fatal — usiamo i fallback default.
                        this.theme = {};
                    }
                }
            }
            this.applyTheme();
        } catch (e) {
            this.fatalError = this.errorMessage(e);
        } finally {
            this.loading = false;
        }
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
            primary: '--survey-primary',
            background: '--survey-bg',
            surface: '--survey-surface',
            text: '--survey-text',
            muted: '--survey-muted',
            error: '--survey-error',
            radius: '--survey-radius',
            fontFamily: '--survey-font'
        };
        Object.keys(mapping).forEach((key) => {
            if (tokens[key]) {
                host.style.setProperty(mapping[key], tokens[key]);
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
        return this.answers.get(q.id) || { selectedOptionIds: [], freeTextValue: '' };
    }

    get progressPercent() {
        if (!this.survey || !this.survey.questions.length) return 0;
        const total = this.survey.questions.length;
        const seen = this.history.length + 1;
        return Math.min(100, Math.round((seen / total) * 100));
    }

    get showProgressBar() {
        const flag = this.theme && this.theme.layout && this.theme.layout.showProgressBar;
        return flag !== false; // default on
    }

    get title() {
        return (this.theme && this.theme.title) || (this.survey && this.survey.name) || '';
    }

    get intro() {
        return (this.theme && this.theme.intro) || (this.survey && this.survey.description) || '';
    }

    get logoUrl() {
        return this.theme && this.theme.logoUrl;
    }

    get closingMessage() {
        return (
            (this.theme && this.theme.closingMessage) ||
            'Grazie per aver completato il questionario.'
        );
    }

    get nextLabel() {
        return this.labelFor('next', 'Avanti');
    }
    get backLabel() {
        return this.labelFor('back', 'Indietro');
    }
    get submitLabel() {
        return this.labelFor('submit', 'Invia');
    }

    labelFor(key, fallback) {
        return (this.theme && this.theme.labels && this.theme.labels[key]) || fallback;
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
            isSingleChoice: q.type === 'SingleChoice',
            isMultiChoice: q.type === 'MultiChoice',
            isFreeText: q.type === 'FreeText',
            isScale: q.type === 'Scale',
            isDate: q.type === 'Date',
            usesFreeTextInput: FREE_TEXT_TYPES.has(q.type),
            freeTextValue: answer.freeTextValue || '',
            options: (q.options || []).map((o) => ({
                ...o,
                checked: selected.has(o.id),
                showFreeText: selected.has(o.id) && o.allowsFreeText,
                inputType: q.type === 'MultiChoice' ? 'checkbox' : 'radio',
                inputName: `q-${q.id}`,
                optionFreeTextValue:
                    selected.has(o.id) && o.allowsFreeText ? answer.freeTextValue || '' : ''
            }))
        };
    }

    // ---------------- Event handlers ----------------

    handleOptionToggle(event) {
        const optionId = event.target.dataset.optionId;
        const q = this.currentQuestion;
        if (!q) return;
        const answer = this.cloneAnswer(q.id);

        if (q.type === 'SingleChoice') {
            answer.selectedOptionIds = [optionId];
            answer.freeTextValue = ''; // reset any prior "Other" text
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
        this.isSubmitting = true;
        try {
            const payload = {
                surveyId: this.survey.id,
                entityMappingJson: this.entityMapping || null,
                answers: [...this.answers.entries()].map(([questionId, a]) => ({
                    questionId,
                    selectedOptionIds: a.selectedOptionIds || [],
                    freeTextValue: a.freeTextValue || null
                }))
            };
            await submitResponse({ submissionJson: JSON.stringify(payload) });
            this.isCompleted = true;
        } catch (e) {
            this.fatalError = this.errorMessage(e);
        } finally {
            this.isSubmitting = false;
        }
    }

    // ---------------- Validation & navigation ----------------

    validateAnswer(q) {
        const answer = this.answers.get(q.id);
        const hasSelection =
            answer && answer.selectedOptionIds && answer.selectedOptionIds.length > 0;
        const hasFreeText = answer && answer.freeTextValue && answer.freeTextValue.trim();

        if (q.isRequired && !hasSelection && !hasFreeText) {
            return 'Questa domanda è obbligatoria.';
        }
        if (FREE_TEXT_TYPES.has(q.type) && hasFreeText && q.validationRegex) {
            try {
                const re = new RegExp(q.validationRegex);
                if (!re.test(answer.freeTextValue)) {
                    return q.validationErrorMessage || 'Il valore inserito non è valido.';
                }
            } catch (e) {
                return 'Regex di validazione non valida (admin error).';
            }
        }
        // Free-text companion validation for selected options with Allows_Free_Text.
        if (hasSelection) {
            for (const optId of answer.selectedOptionIds) {
                const opt = q.options.find((o) => o.id === optId);
                if (!opt || !opt.allowsFreeText) continue;
                if (!hasFreeText && opt.allowsFreeText) {
                    return 'Specifica il testo libero per l\'opzione selezionata.';
                }
                if (opt.freeTextRegex) {
                    try {
                        const re = new RegExp(opt.freeTextRegex);
                        if (!re.test(answer.freeTextValue)) {
                            return (
                                opt.freeTextErrorMessage ||
                                'Il testo libero non è valido.'
                            );
                        }
                    } catch (e) {
                        return 'Regex di validazione non valida (admin error).';
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
            freeTextValue: ''
        };
        return {
            selectedOptionIds: [...(existing.selectedOptionIds || [])],
            freeTextValue: existing.freeTextValue || ''
        };
    }

    errorMessage(e) {
        if (!e) return 'Errore sconosciuto';
        if (e.body && e.body.message) return e.body.message;
        if (e.message) return e.message;
        return String(e);
    }
}
