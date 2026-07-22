import { LightningElement, track, wire } from "lwc";
import { refreshApex } from "@salesforce/apex";
import { createRecord, updateRecord } from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";

import getSurveyById from "@salesforce/apex/SurveyController.getSurveyById";
import registerThemeLogo from "@salesforce/apex/SurveyController.registerThemeLogo";

const THEME_API = "Survey_Theme__c";
const SAVE_DEBOUNCE_MS = 400;

/** Field defaults for a newly created theme (the name is chosen by the user). */
const NEW_THEME_DEFAULTS = {
  Primary_Color__c: "#0070D2",
  Background_Color__c: "#F4F6F9",
  Surface_Color__c: "#FFFFFF",
  Text_Color__c: "#16325C",
  Muted_Color__c: "#54698D",
  Error_Color__c: "#C23934",
  Border_Radius__c: 8,
  Font_Family__c: "'Salesforce Sans', Arial, sans-serif",
  Show_Progress_Bar__c: true
};

/** Theme color fields → editor rows. `fallback` feeds the native color input when empty. */
const COLOR_FIELDS = [
  {
    field: "Primary_Color__c",
    dto: "primaryColor",
    label: "Colore primario",
    fallback: "#0070D2"
  },
  {
    field: "Background_Color__c",
    dto: "backgroundColor",
    label: "Sfondo pagina",
    fallback: "#F4F6F9"
  },
  {
    field: "Surface_Color__c",
    dto: "surfaceColor",
    label: "Sfondo card",
    fallback: "#FFFFFF"
  },
  {
    field: "Text_Color__c",
    dto: "textColor",
    label: "Testo",
    fallback: "#16325C"
  },
  {
    field: "Muted_Color__c",
    dto: "mutedColor",
    label: "Testo secondario",
    fallback: "#54698D"
  },
  {
    field: "Error_Color__c",
    dto: "errorColor",
    label: "Errore",
    fallback: "#C23934"
  }
];

/** Survey frame-text fields → DTO properties (edited in the texts panel). */
const TEXT_FIELD_TO_DTO = {
  Display_Title__c: "displayTitle",
  Intro_Text__c: "introText",
  Closing_Message__c: "closingMessage",
  Next_Label__c: "nextLabel",
  Back_Label__c: "backLabel",
  Submit_Label__c: "submitLabel"
};

const THEME_FIELD_TO_DTO = {
  Primary_Color__c: "primaryColor",
  Background_Color__c: "backgroundColor",
  Surface_Color__c: "surfaceColor",
  Text_Color__c: "textColor",
  Muted_Color__c: "mutedColor",
  Error_Color__c: "errorColor",
  Border_Radius__c: "borderRadius",
  Font_Family__c: "fontFamily",
  Show_Progress_Bar__c: "showProgressBar",
  Logo_Height__c: "logoHeight"
};

const DEFAULT_LOGO_HEIGHT = 60;

export default class SurveyExperienceEditor extends LightningElement {
  @track surveyId;
  @track saving = false;
  @track showNewThemeForm = false;
  @track newThemeName = "";

  survey;
  wiredSurvey;
  pendingSaves = new Map();

  surveyPickerMatchingInfo = { primaryField: { fieldPath: "Name" } };
  surveyPickerDisplayInfo = {
    primaryField: "Name",
    additionalFields: ["Status__c"]
  };
  themePickerMatchingInfo = { primaryField: { fieldPath: "Name" } };
  themePickerDisplayInfo = { primaryField: "Name" };

  logoAcceptedFormats = [".png", ".jpg", ".jpeg", ".gif", ".svg"];

  @wire(getSurveyById, { surveyId: "$surveyId" })
  wiredHandler(result) {
    this.wiredSurvey = result;
    if (result.data) {
      // Deep copy for optimistic local edits (inputs bind to this.survey).
      this.survey = JSON.parse(JSON.stringify(result.data));
    } else if (result.error) {
      this.survey = undefined;
      if (this.surveyId) {
        this.toast("error", this.errorMessage(result.error));
      }
    }
  }

  // ---------------- View-model ----------------

  get hasSurvey() {
    return !!this.survey;
  }

  get theme() {
    return this.survey ? this.survey.theme : null;
  }

  get hasTheme() {
    return !!this.theme;
  }

  get themeId() {
    return this.theme ? this.theme.id : null;
  }

  get sharedThemeWarning() {
    if (!this.theme || !this.theme.usageCount || this.theme.usageCount <= 1) {
      return null;
    }
    return (
      "Questo tema è usato da " +
      this.theme.usageCount +
      " survey: le modifiche estetiche impattano tutti."
    );
  }

  get colorRows() {
    const t = this.theme || {};
    return COLOR_FIELDS.map((c) => {
      const value = t[c.dto] || "";
      return {
        field: c.field,
        label: c.label,
        value,
        pickerValue: value || c.fallback,
        hasValue: !!value
      };
    });
  }

  get borderRadius() {
    return this.theme ? this.theme.borderRadius : null;
  }

  get fontFamily() {
    return this.theme ? this.theme.fontFamily : "";
  }

  get showProgressBar() {
    return this.theme ? this.theme.showProgressBar !== false : true;
  }

  get logoUrl() {
    return this.theme ? this.theme.logoUrl : null;
  }

  get logoHeight() {
    return this.theme && this.theme.logoHeight != null
      ? this.theme.logoHeight
      : null;
  }

  get logoPreviewStyle() {
    const height = this.logoHeight || DEFAULT_LOGO_HEIGHT;
    return `height: ${height}px; width: auto;`;
  }

  get texts() {
    const s = this.survey || {};
    return {
      displayTitle: s.displayTitle || "",
      introText: s.introText || "",
      closingMessage: s.closingMessage || "",
      nextLabel: s.nextLabel || "",
      backLabel: s.backLabel || "",
      submitLabel: s.submitLabel || "",
      titlePlaceholder: s.name || "",
      introPlaceholder: s.description || ""
    };
  }

  // ---------------- Survey & theme selection ----------------

  handleSurveyPickerChange(event) {
    const newId = (event.detail && event.detail.recordId) || undefined;
    if (newId === this.surveyId) return;
    this.flushPendingSaves();
    this.surveyId = newId;
    this.survey = undefined;
  }

  // ---------------- New theme (with user-chosen name) ----------------

  handleNewThemeToggle() {
    this.showNewThemeForm = !this.showNewThemeForm;
    this.newThemeName = "";
  }

  handleNewThemeNameChange(event) {
    this.newThemeName = event.target.value;
  }

  handleNewThemeKeyUp(event) {
    if (event.key === "Enter") {
      this.handleCreateTheme();
    }
  }

  async handleThemePickerChange(event) {
    const themeId = (event.detail && event.detail.recordId) || null;
    if (!this.surveyId) return;
    await this.tryDml(
      () => updateRecord({ fields: { Id: this.surveyId, Theme__c: themeId } }),
      themeId ? "Tema assegnato" : "Tema rimosso"
    );
    await this.refreshAll();
  }

  async handleCreateTheme() {
    if (!this.surveyId) return;
    const name = (this.newThemeName || "").trim();
    if (!name) {
      this.toast("error", "Inserisci il nome del nuovo tema");
      return;
    }
    try {
      this.saving = true;
      const created = await createRecord({
        apiName: THEME_API,
        fields: { ...NEW_THEME_DEFAULTS, Name: name }
      });
      await updateRecord({
        fields: { Id: this.surveyId, Theme__c: created.id }
      });
      this.showNewThemeForm = false;
      this.newThemeName = "";
      this.toast("success", 'Tema "' + name + '" creato e assegnato al survey');
      await this.refreshAll();
    } catch (e) {
      this.toast("error", this.errorMessage(e));
    } finally {
      this.saving = false;
    }
  }

  // ---------------- Theme edits ----------------

  handleColorInput(event) {
    const field = event.target.dataset.field;
    const value = event.target.value ? event.target.value.toUpperCase() : null;
    this.applyThemeLocal(field, value);
    this.scheduleThemeSave(field, value);
  }

  handleColorClear(event) {
    const field = event.currentTarget.dataset.field;
    this.applyThemeLocal(field, null);
    this.scheduleThemeSave(field, null);
  }

  handleRadiusChange(event) {
    const value = event.target.value === "" ? null : Number(event.target.value);
    this.applyThemeLocal("Border_Radius__c", value);
    this.scheduleThemeSave("Border_Radius__c", value);
  }

  handleFontChange(event) {
    const value = event.target.value || null;
    this.applyThemeLocal("Font_Family__c", value);
    this.scheduleThemeSave("Font_Family__c", value);
  }

  handleProgressBarToggle(event) {
    const value = event.target.checked;
    this.applyThemeLocal("Show_Progress_Bar__c", value);
    this.scheduleThemeSave("Show_Progress_Bar__c", value);
  }

  handleLogoHeightChange(event) {
    const value = event.target.value === "" ? null : Number(event.target.value);
    this.applyThemeLocal("Logo_Height__c", value);
    this.scheduleThemeSave("Logo_Height__c", value);
  }

  applyThemeLocal(fieldApi, value) {
    if (!this.survey || !this.survey.theme) return;
    const prop = THEME_FIELD_TO_DTO[fieldApi];
    if (prop) {
      this.survey.theme[prop] = value;
      this.survey = { ...this.survey };
    }
  }

  scheduleThemeSave(fieldApi, value) {
    if (!this.themeId) return;
    this.scheduleSave("theme_" + fieldApi, {
      Id: this.themeId,
      [fieldApi]: value
    });
  }

  // ---------------- Survey text edits ----------------

  handleTextChange(event) {
    const field = event.target.dataset.field;
    if (!field || !this.surveyId) return;
    const value = event.target.value || null;
    const prop = TEXT_FIELD_TO_DTO[field];
    if (prop && this.survey) {
      this.survey[prop] = value;
      this.survey = { ...this.survey };
    }
    this.scheduleSave("survey_" + field, {
      Id: this.surveyId,
      [field]: value
    });
  }

  // ---------------- Logo upload ----------------

  async handleLogoUploaded(event) {
    const files = event.detail.files || [];
    if (!files.length || !this.themeId) return;
    try {
      await registerThemeLogo({
        themeId: this.themeId,
        contentDocumentId: files[0].documentId
      });
      this.toast("success", "Logo caricato");
    } catch (e) {
      this.toast("error", this.errorMessage(e));
    }
    await this.refreshAll();
  }

  // ---------------- Debounced saves & preview refresh ----------------

  /** One updateRecord per quiescent edit, then refresh data + live preview. */
  scheduleSave(key, fields) {
    const existing = this.pendingSaves.get(key);
    if (existing) clearTimeout(existing.timer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    const timer = setTimeout(async () => {
      this.pendingSaves.delete(key);
      await this.tryDml(() => updateRecord({ fields }), null);
      await this.refreshAll();
    }, SAVE_DEBOUNCE_MS);
    this.pendingSaves.set(key, { timer, fields });
  }

  async flushPendingSaves() {
    if (!this.pendingSaves.size) return;
    const calls = [];
    for (const [, entry] of this.pendingSaves.entries()) {
      clearTimeout(entry.timer);
      calls.push(updateRecord({ fields: entry.fields }));
    }
    this.pendingSaves.clear();
    try {
      await Promise.all(calls);
    } catch (e) {
      this.toast("error", this.errorMessage(e));
    }
  }

  async refreshAll() {
    if (this.wiredSurvey) {
      await refreshApex(this.wiredSurvey);
    }
    const runner = this.template.querySelector("c-survey-runner");
    if (runner) {
      await runner.refresh();
    }
  }

  // ---------------- Helpers ----------------

  async tryDml(fn, successMessage) {
    this.saving = true;
    try {
      await fn();
      if (successMessage) this.toast("success", successMessage);
    } catch (e) {
      this.toast("error", this.errorMessage(e));
    } finally {
      this.saving = false;
    }
  }

  toast(variant, message) {
    this.dispatchEvent(
      new ShowToastEvent({
        title: variant === "error" ? "Errore" : "OK",
        message: String(message),
        variant
      })
    );
  }

  errorMessage(e) {
    if (!e) return "Errore sconosciuto";
    if (e.body && e.body.message) return e.body.message;
    if (e.body && Array.isArray(e.body) && e.body[0]) return e.body[0].message;
    if (e.message) return e.message;
    return String(e);
  }
}
