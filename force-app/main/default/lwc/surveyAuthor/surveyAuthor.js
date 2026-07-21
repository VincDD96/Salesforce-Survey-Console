import { LightningElement, track, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { createRecord, updateRecord, deleteRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import getSurveyById from '@salesforce/apex/SurveyController.getSurveyById';
import validateGraph from '@salesforce/apex/SurveyController.validateGraph';

const NODE_WIDTH = 240;
const TITLE_LINE_HEIGHT = 16;
const TITLE_TOP_PAD = 14;
const TITLE_BOTTOM_PAD = 10;
const MAX_TITLE_LINES = 3;
const TITLE_MAX_CHARS_PER_LINE = 28;
const ROW_HEIGHT = 26;
const ROW_PAD = 6;
const H_GAP = 90;
const V_GAP = 28;
const CANVAS_PAD = 24;

const QUESTION_API = 'Question__c';
const OPTION_API = 'Answer_Option__c';
const SURVEY_API = 'Survey__c';

const SAVE_DEBOUNCE_MS = 400;

const QUESTION_FIELD_TO_DTO = {
    Question_Text__c: 'text',
    Type__c: 'type',
    Order__c: 'orderHint',
    Is_Required__c: 'isRequired',
    Validation_Regex__c: 'validationRegex',
    Validation_Error_Message__c: 'validationErrorMessage',
    Placeholder__c: 'placeholder',
    Default_Next_Question__c: 'defaultNextQuestionId',
    Editor_X__c: 'editorX',
    Editor_Y__c: 'editorY'
};

const OPTION_FIELD_TO_DTO = {
    Option_Text__c: 'text',
    Order__c: 'orderHint',
    Allows_Free_Text__c: 'allowsFreeText',
    Free_Text_Regex__c: 'freeTextRegex',
    Free_Text_Error_Message__c: 'freeTextErrorMessage',
    Next_Question__c: 'nextQuestionId'
};

const TYPE_OPTIONS = [
    { label: 'Single Choice', value: 'SingleChoice' },
    { label: 'Multi Choice', value: 'MultiChoice' },
    { label: 'Free Text', value: 'FreeText' },
    { label: 'Scale', value: 'Scale' },
    { label: 'Date', value: 'Date' }
];

export default class SurveyAuthor extends LightningElement {
    @track surveyId;
    @track selectedQuestionId;
    @track validation;
    @track validationRunning = false;
    @track autoLayout = true;
    @track dirty = false; // true while a save is in flight

    survey;
    wiredSurvey;
    /** in-memory positions for the duration of a drag (committed to DB on mouseup) */
    pendingPositions = new Map();
    /** drag state */
    dragState = null;
    /** connection-drag state */
    connectState = null;
    /** transient preview line for connection drag, in viewBox coords */
    @track previewLine = null;

    layout = { nodes: [], edges: [], viewBox: '0 0 800 600', width: 800, height: 600 };

    typeOptions = TYPE_OPTIONS;

    /** lightning-record-picker descriptors: where to search and what to render. */
    pickerMatchingInfo = {
        primaryField: { fieldPath: 'Name' }
    };
    pickerDisplayInfo = {
        primaryField: 'Name',
        additionalFields: ['Status__c']
    };

    @wire(getSurveyById, { surveyId: '$surveyId' })
    wiredHandler(result) {
        this.wiredSurvey = result;
        if (result.data) {
            // Deep copy so we can apply optimistic local mutations on edit
            // (lightning-input value bindings read from this.survey).
            this.survey = JSON.parse(JSON.stringify(result.data));
            this.reconcilePendingPositions();
            this.computeLayout();
        }
    }

    reconcilePendingPositions() {
        if (!this.pendingPositions.size) return;
        for (const q of this.survey.questions || []) {
            const p = this.pendingPositions.get(q.id);
            if (!p) continue;
            const dbX = q.editorX != null ? Number(q.editorX) : null;
            const dbY = q.editorY != null ? Number(q.editorY) : null;
            if (
                dbX != null &&
                dbY != null &&
                Math.abs(dbX - p.x) <= 1 &&
                Math.abs(dbY - p.y) <= 1
            ) {
                this.pendingPositions.delete(q.id);
            }
        }
    }

    // ---------------- Toolbar ----------------

    handleSurveyPickerChange(event) {
        // lightning-record-picker emits change with detail.recordId (null = cleared)
        const newId = (event.detail && event.detail.recordId) || undefined;
        if (newId === this.surveyId) return;
        this.surveyId = newId;
        this.selectedQuestionId = undefined;
        this.validation = undefined;
        this.pendingPositions.clear();
    }

    async handleRefresh() {
        await this.flushPendingSaves();
        if (this.wiredSurvey) {
            await refreshApex(this.wiredSurvey);
        }
    }

    async flushPendingSaves() {
        if (!this.pendingSaves || !this.pendingSaves.size) return;
        const calls = [];
        for (const [, entry] of this.pendingSaves.entries()) {
            clearTimeout(entry.timer);
            calls.push(updateRecord({ fields: entry.fields }));
        }
        this.pendingSaves.clear();
        try {
            await Promise.all(calls);
        } catch (e) {
            this.toast('error', this.errorMessage(e));
        }
    }

    handleAutoLayoutToggle(event) {
        this.autoLayout = event.target.checked;
        this.computeLayout();
    }

    async handleValidate() {
        if (!this.surveyId) return;
        this.validationRunning = true;
        try {
            this.validation = await validateGraph({ surveyId: this.surveyId });
        } catch (e) {
            this.validation = { isValid: false, errors: [this.errorMessage(e)], cycles: [] };
        } finally {
            this.validationRunning = false;
            this.computeLayout();
        }
    }

    async handleAddQuestion() {
        if (!this.surveyId) {
            this.toast('error', 'Carica prima un Survey');
            return;
        }
        const x = 40 + Math.floor(Math.random() * 200);
        const y = 40 + Math.floor(Math.random() * 200);
        const fields = {
            Survey__c: this.surveyId,
            Question_Text__c: 'Nuova domanda',
            Type__c: 'SingleChoice',
            Is_Required__c: false,
            Editor_X__c: x,
            Editor_Y__c: y
        };
        await this.tryDml(() => createRecord({ apiName: QUESTION_API, fields }), 'Domanda creata');
        await this.handleRefresh();
    }

    async handleSetAsStart() {
        if (!this.selectedQuestionId || !this.surveyId) return;
        await this.tryDml(
            () =>
                updateRecord({
                    fields: { Id: this.surveyId, Start_Question__c: this.selectedQuestionId }
                }),
            'Start question impostata'
        );
        await this.handleRefresh();
    }

    // ---------------- Node selection ----------------

    handleNodeClick(event) {
        // Click without drag → open inspector
        if (this.dragState && this.dragState.moved) return;
        this.selectedQuestionId = event.currentTarget.dataset.questionId;
    }

    handleCloseInspector() {
        this.selectedQuestionId = undefined;
    }

    // ---------------- Node drag ----------------

    handleNodeMouseDown(event) {
        if (this.autoLayout) return;
        if (event.target.classList && event.target.classList.contains('row-port')) {
            return;
        }
        event.preventDefault();
        const questionId = event.currentTarget.dataset.questionId;
        const point = this.svgPoint(event);
        const node = this.layout.nodes.find((n) => n.id === questionId);
        if (!point || !node) return;
        // Use the node's *effective* current position (pending takes precedence
        // over the layout snapshot) so we don't capture a stale offset.
        const pending = this.pendingPositions.get(questionId);
        const baseX = pending ? pending.x : node.x;
        const baseY = pending ? pending.y : node.y;
        this.dragState = {
            kind: 'node',
            questionId,
            offsetX: point.x - baseX,
            offsetY: point.y - baseY,
            moved: false,
            lastX: baseX,
            lastY: baseY
        };
    }

    handleSvgMouseMove(event) {
        if (!this.dragState && !this.connectState) return;
        if (this.dragState && this.dragState.kind === 'node') {
            event.preventDefault();
            const point = this.svgPoint(event);
            if (!point) return;
            this.dragState.lastX = Math.max(0, point.x - this.dragState.offsetX);
            this.dragState.lastY = Math.max(0, point.y - this.dragState.offsetY);
            this.dragState.moved = true;
            this.scheduleDragFrame();
        } else if (this.connectState) {
            const point = this.svgPoint(event);
            if (!point) return;
            this.connectState.lastX = point.x;
            this.connectState.lastY = point.y;
            this.scheduleDragFrame();
        }
    }

    /**
     * Coalesces mousemoves into one paint per frame. Without this, computeLayout
     * runs 60+ times/sec and the visual node lags well behind the cursor.
     */
    scheduleDragFrame() {
        if (this.rafScheduled) return;
        this.rafScheduled = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            this.rafScheduled = false;
            if (this.dragState && this.dragState.kind === 'node') {
                this.pendingPositions.set(this.dragState.questionId, {
                    x: this.dragState.lastX,
                    y: this.dragState.lastY
                });
                this.computeLayout();
            } else if (this.connectState) {
                this.previewLine = {
                    x1: this.connectState.fromX,
                    y1: this.connectState.fromY,
                    x2: this.connectState.lastX,
                    y2: this.connectState.lastY
                };
            }
        });
    }

    async handleSvgMouseUp(event) {
        // Snapshot the drag state and clear it BEFORE any await. Otherwise the
        // node keeps following the cursor while updateRecord is in flight.
        const node = this.dragState && this.dragState.kind === 'node' ? this.dragState : null;
        const connect = this.connectState;
        this.dragState = null;
        this.connectState = null;
        this.previewLine = null;

        if (node && node.moved) {
            const point = this.svgPoint(event);
            const finalX = point ? Math.max(0, point.x - node.offsetX) : node.lastX;
            const finalY = point ? Math.max(0, point.y - node.offsetY) : node.lastY;
            this.pendingPositions.set(node.questionId, { x: finalX, y: finalY });
            this.computeLayout();
            await this.tryDml(
                () =>
                    updateRecord({
                        fields: {
                            Id: node.questionId,
                            Editor_X__c: Math.round(finalX),
                            Editor_Y__c: Math.round(finalY)
                        }
                    }),
                null
            );
        }

        if (connect) {
            const targetNodeId = this.nodeIdAtPoint(event);
            if (targetNodeId && targetNodeId !== connect.fromQuestionId) {
                await this.setNextQuestion(connect, targetNodeId);
                await this.handleRefresh();
            }
            this.computeLayout();
        }
    }

    handleSvgMouseLeave() {
        this.dragState = null;
        this.connectState = null;
        this.previewLine = null;
    }

    nodeIdAtPoint(event) {
        // Walk the event composedPath looking for a <g> with data-question-id.
        const path = event.composedPath ? event.composedPath() : [];
        for (const el of path) {
            if (el.dataset && el.dataset.questionId) return el.dataset.questionId;
        }
        return null;
    }

    // ---------------- Connection drag (drag from a row's port) ----------------

    handlePortMouseDown(event) {
        event.stopPropagation();
        event.preventDefault();
        const questionId = event.currentTarget.dataset.questionId;
        const rowKey = event.currentTarget.dataset.rowKey;
        const rowKind = event.currentTarget.dataset.rowKind;
        const point = this.svgPoint(event);
        if (!point) return;
        this.connectState = {
            kind: 'connect',
            fromQuestionId: questionId,
            fromRowKey: rowKey,
            fromRowKind: rowKind,
            fromX: point.x,
            fromY: point.y
        };
        this.previewLine = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
    }

    async setNextQuestion(connectState, targetQuestionId) {
        if (connectState.fromRowKind === 'default') {
            await this.tryDml(
                () =>
                    updateRecord({
                        fields: {
                            Id: connectState.fromQuestionId,
                            Default_Next_Question__c: targetQuestionId
                        }
                    }),
                'Default next aggiornato'
            );
        } else if (connectState.fromRowKind === 'option') {
            await this.tryDml(
                () =>
                    updateRecord({
                        fields: {
                            Id: connectState.fromRowKey,
                            Next_Question__c: targetQuestionId
                        }
                    }),
                'Edge aggiornato'
            );
        }
        // 'terminal' rows have no real record — connecting from them means
        // adding a default-next on the question.
        if (connectState.fromRowKind === 'terminal') {
            await this.tryDml(
                () =>
                    updateRecord({
                        fields: {
                            Id: connectState.fromQuestionId,
                            Default_Next_Question__c: targetQuestionId
                        }
                    }),
                'Default next aggiornato'
            );
        }
    }

    // ---------------- Inspector: question fields ----------------

    get inspectorQuestion() {
        if (!this.selectedQuestionId || !this.survey) return null;
        return this.survey.questions.find((q) => q.id === this.selectedQuestionId);
    }

    get inspectorQuestionView() {
        const q = this.inspectorQuestion;
        if (!q) return null;
        const others = this.otherQuestionOptions(q.id);
        return {
            ...q,
            options: (q.options || []).map((o) => ({
                ...o,
                nextOptions: others
            })),
            defaultNextOptions: others
        };
    }

    otherQuestionOptions(currentId) {
        if (!this.survey) return [];
        return [
            { label: '— (terminal) —', value: '' },
            ...this.survey.questions
                .filter((q) => q.id !== currentId)
                .map((q) => ({
                    label: this.truncate(q.text || '(empty)', 50),
                    value: q.id
                }))
        ];
    }

    handleQuestionFieldChange(event) {
        const field = event.target.dataset.field;
        if (!field) return;
        const value = this.readInputValue(event.target);
        this.applyQuestionLocal(this.selectedQuestionId, field, value);
        this.scheduleSave('Question_' + this.selectedQuestionId + '_' + field, {
            Id: this.selectedQuestionId,
            [field]: value
        });
    }

    async handleDeleteQuestion() {
        if (!this.selectedQuestionId) return;
        // eslint-disable-next-line no-alert
        const ok = window.confirm('Eliminare questa domanda e tutte le sue opzioni?');
        if (!ok) return;
        const id = this.selectedQuestionId;
        this.selectedQuestionId = undefined;
        await this.tryDml(() => deleteRecord(id), 'Domanda eliminata');
        await this.handleRefresh();
    }

    // ---------------- Inspector: options ----------------

    handleOptionFieldChange(event) {
        const optionId = event.target.dataset.optionId;
        const field = event.target.dataset.field;
        if (!optionId || !field) return;
        const value = this.readInputValue(event.target);
        this.applyOptionLocal(optionId, field, value);
        this.scheduleSave('Option_' + optionId + '_' + field, {
            Id: optionId,
            [field]: value
        });
    }

    handleOptionNextChange(event) {
        const optionId = event.target.dataset.optionId;
        if (!optionId) return;
        const raw = event.target.value || null;
        this.applyOptionLocal(optionId, 'Next_Question__c', raw);
        this.scheduleSave('Option_' + optionId + '_Next', {
            Id: optionId,
            Next_Question__c: raw
        });
    }

    handleQuestionDefaultNextChange(event) {
        if (!this.selectedQuestionId) return;
        const raw = event.target.value || null;
        this.applyQuestionLocal(this.selectedQuestionId, 'Default_Next_Question__c', raw);
        this.scheduleSave('Question_' + this.selectedQuestionId + '_DefaultNext', {
            Id: this.selectedQuestionId,
            Default_Next_Question__c: raw
        });
    }

    // ---------------- Local optimistic mutation + debounced save ----------------

    applyQuestionLocal(qid, apiName, value) {
        if (!this.survey) return;
        const q = this.survey.questions.find((x) => x.id === qid);
        if (!q) return;
        const prop = QUESTION_FIELD_TO_DTO[apiName];
        if (prop) {
            q[prop] = value;
            this.computeLayout();
        }
    }

    applyOptionLocal(optionId, apiName, value) {
        if (!this.survey) return;
        for (const q of this.survey.questions) {
            const opt = (q.options || []).find((o) => o.id === optionId);
            if (opt) {
                const prop = OPTION_FIELD_TO_DTO[apiName];
                if (prop) {
                    opt[prop] = value;
                    this.computeLayout();
                }
                return;
            }
        }
    }

    /** Per-key debounce so we issue one updateRecord per quiescent edit, not per keystroke. */
    scheduleSave(key, fields) {
        if (!this.pendingSaves) this.pendingSaves = new Map();
        const existing = this.pendingSaves.get(key);
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            this.pendingSaves.delete(key);
            this.tryDml(() => updateRecord({ fields: fields }), null);
        }, SAVE_DEBOUNCE_MS);
        this.pendingSaves.set(key, { timer, fields });
    }

    async handleAddOption() {
        if (!this.selectedQuestionId) return;
        const fields = {
            Question__c: this.selectedQuestionId,
            Option_Text__c: 'Nuova opzione',
            Order__c:
                (this.inspectorQuestion?.options?.length || 0) + 1,
            Allows_Free_Text__c: false
        };
        await this.tryDml(() => createRecord({ apiName: OPTION_API, fields }), 'Opzione creata');
        await this.handleRefresh();
    }

    async handleDeleteOption(event) {
        const optionId = event.currentTarget.dataset.optionId;
        if (!optionId) return;
        // eslint-disable-next-line no-alert
        const ok = window.confirm('Eliminare questa opzione?');
        if (!ok) return;
        await this.tryDml(() => deleteRecord(optionId), 'Opzione eliminata');
        await this.handleRefresh();
    }

    // ---------------- Layout (auto vs manual) ----------------

    computeLayout() {
        if (!this.survey || !this.survey.questions || !this.survey.questions.length) {
            this.layout = { nodes: [], edges: [], viewBox: '0 0 800 600', width: 800, height: 600 };
            return;
        }

        const rowsByQuestion = this.buildRows(this.survey.questions);

        const positions = this.autoLayout
            ? this.bfsPositions(this.survey.questions, rowsByQuestion)
            : this.manualPositions(this.survey.questions, rowsByQuestion);

        // Apply pending drag positions (overrides the saved/auto position).
        for (const [qid, p] of this.pendingPositions.entries()) {
            if (positions.has(qid)) {
                const h = positions.get(qid).h;
                positions.set(qid, { x: p.x, y: p.y, h });
            }
        }

        // Flagging sets.
        const cyclesSet = new Set();
        if (this.validation && this.validation.cycles) {
            for (const cycle of this.validation.cycles) for (const id of cycle) cyclesSet.add(id);
        }
        const adjacency = new Map();
        for (const q of this.survey.questions) {
            const targets = new Set();
            for (const row of rowsByQuestion.get(q.id)) {
                if (row.nextQuestionId) targets.add(row.nextQuestionId);
            }
            adjacency.set(q.id, targets);
        }
        const reachable = new Set();
        if (this.survey.startQuestionId) {
            const stack = [this.survey.startQuestionId];
            while (stack.length) {
                const id = stack.pop();
                if (reachable.has(id)) continue;
                reachable.add(id);
                for (const next of adjacency.get(id) || []) stack.push(next);
            }
        }

        // Materialize node DTOs.
        const nodes = [];
        let maxX = 0;
        let maxY = 0;
        for (const q of this.survey.questions) {
            const pos = positions.get(q.id);
            const cls = ['author-node'];
            if (q.id === this.survey.startQuestionId) cls.push('is-start');
            if (cyclesSet.has(q.id)) cls.push('is-cycle');
            if (this.survey.startQuestionId && !reachable.has(q.id)) cls.push('is-orphan');
            if (q.id === this.selectedQuestionId) cls.push('is-selected');

            const { lines: titleTextLines, titleHeight } = this.titleGeometry(q.text);
            const titleLines = titleTextLines.map((line, i) => ({
                key: q.id + '-titleLine-' + i,
                text: line,
                x: pos.x + 12,
                y: pos.y + TITLE_TOP_PAD + (i + 1) * TITLE_LINE_HEIGHT - 4
            }));
            const separatorY = pos.y + titleHeight;

            const rows = rowsByQuestion.get(q.id).map((row, idx) => {
                const rowYTop = separatorY + ROW_PAD + idx * ROW_HEIGHT;
                const rowYMid = rowYTop + ROW_HEIGHT / 2;
                return {
                    key: row.key,
                    label: this.truncate(row.label, 28),
                    fullLabel: row.label,
                    cssClass: 'row row-' + row.kind,
                    labelX: pos.x + 12,
                    labelY: rowYMid + 4,
                    portX: pos.x + NODE_WIDTH - 8,
                    portY: rowYMid,
                    nextQuestionId: row.nextQuestionId,
                    kind: row.kind,
                    questionId: q.id
                };
            });

            const h = titleHeight + ROW_PAD * 2 + rows.length * ROW_HEIGHT;
            nodes.push({
                id: q.id,
                cssClass: cls.join(' '),
                x: pos.x,
                y: pos.y,
                w: NODE_WIDTH,
                h,
                titleLines,
                typeX: pos.x + NODE_WIDTH - 12,
                typeY: pos.y + TITLE_TOP_PAD + TITLE_LINE_HEIGHT - 4,
                separatorX1: pos.x,
                separatorX2: pos.x + NODE_WIDTH,
                separatorY,
                type: q.type,
                rows
            });
            maxX = Math.max(maxX, pos.x + NODE_WIDTH);
            maxY = Math.max(maxY, pos.y + h);
        }

        // Build edges from row ports to target node centers.
        const edges = [];
        const positionsMap = positions;
        for (const node of nodes) {
            for (const row of node.rows) {
                if (!row.nextQuestionId || !positionsMap.has(row.nextQuestionId)) continue;
                const target = positionsMap.get(row.nextQuestionId);
                const targetNode = nodes.find((n) => n.id === row.nextQuestionId);
                if (!targetNode) continue;
                const x1 = row.portX;
                const y1 = row.portY;
                const x2 = targetNode.x;
                const y2 = targetNode.y + targetNode.h / 2;
                const dx = Math.max(40, Math.abs(x2 - x1) / 2);
                edges.push({
                    key: node.id + '->' + row.key,
                    d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
                    cssClass: 'edge edge-' + row.kind,
                    tipX: x2,
                    tipY: y2,
                    label: this.truncate(row.fullLabel, 18),
                    labelX: (x1 + x2) / 2,
                    labelY: (y1 + y2) / 2 - 6,
                    hasLabel: row.kind !== 'terminal'
                });
            }
        }

        const width = Math.max(800, maxX + CANVAS_PAD * 2);
        const height = Math.max(600, maxY + CANVAS_PAD * 2);
        this.layout = {
            nodes,
            edges,
            viewBox: `0 0 ${width} ${height}`,
            width,
            height
        };
    }

    buildRows(questions) {
        const rowsByQuestion = new Map();
        for (const q of questions) {
            const rows = [];
            for (const o of q.options || []) {
                rows.push({
                    key: o.id,
                    label: o.text || '(empty option)',
                    nextQuestionId: o.nextQuestionId || null,
                    kind: 'option'
                });
            }
            if (q.defaultNextQuestionId) {
                rows.push({
                    key: 'default-' + q.id,
                    label: '↪ default',
                    nextQuestionId: q.defaultNextQuestionId,
                    kind: 'default'
                });
            }
            if (rows.length === 0) {
                rows.push({
                    key: 'end-' + q.id,
                    label: '— end —',
                    nextQuestionId: null,
                    kind: 'terminal'
                });
            }
            rowsByQuestion.set(q.id, rows);
        }
        return rowsByQuestion;
    }

    bfsPositions(questions, rowsByQuestion) {
        const adjacency = new Map();
        const byId = new Map();
        for (const q of questions) {
            byId.set(q.id, q);
            adjacency.set(q.id, new Set());
        }
        for (const q of questions) {
            for (const row of rowsByQuestion.get(q.id)) {
                if (row.nextQuestionId && adjacency.has(row.nextQuestionId)) {
                    adjacency.get(q.id).add(row.nextQuestionId);
                }
            }
        }

        const depth = new Map();
        const seed = this.survey.startQuestionId && byId.has(this.survey.startQuestionId)
            ? this.survey.startQuestionId
            : questions[0].id;
        const queue = [seed];
        depth.set(seed, 0);
        while (queue.length) {
            const current = queue.shift();
            for (const next of adjacency.get(current) || []) {
                if (!depth.has(next)) {
                    depth.set(next, depth.get(current) + 1);
                    queue.push(next);
                }
            }
        }
        for (const q of questions) {
            if (!depth.has(q.id)) depth.set(q.id, 0);
        }

        const columns = new Map();
        for (const q of questions) {
            const d = depth.get(q.id);
            if (!columns.has(d)) columns.set(d, []);
            columns.get(d).push(q);
        }
        for (const [, list] of columns) {
            list.sort((a, b) => (a.orderHint || 9999) - (b.orderHint || 9999));
        }

        const positions = new Map();
        for (const [d, list] of columns.entries()) {
            let y = CANVAS_PAD;
            for (const q of list) {
                const h = this.nodeHeightFor(q, rowsByQuestion.get(q.id));
                positions.set(q.id, {
                    x: CANVAS_PAD + d * (NODE_WIDTH + H_GAP),
                    y,
                    h
                });
                y += h + V_GAP;
            }
        }
        return positions;
    }

    manualPositions(questions, rowsByQuestion) {
        const positions = new Map();
        let nextFallbackX = CANVAS_PAD;
        let nextFallbackY = CANVAS_PAD;
        for (const q of questions) {
            const h = this.nodeHeightFor(q, rowsByQuestion.get(q.id));
            let x = q.editorX != null ? Number(q.editorX) : null;
            let y = q.editorY != null ? Number(q.editorY) : null;
            if (x == null || y == null) {
                x = nextFallbackX;
                y = nextFallbackY;
                nextFallbackY += h + V_GAP;
                if (nextFallbackY > 800) {
                    nextFallbackY = CANVAS_PAD;
                    nextFallbackX += NODE_WIDTH + H_GAP;
                }
            }
            positions.set(q.id, { x, y, h });
        }
        return positions;
    }

    // ---------------- Helpers ----------------

    svgPoint(event) {
        const svg = this.template.querySelector('svg.author-canvas');
        if (!svg) return null;
        const pt = svg.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        return pt.matrixTransform(ctm.inverse());
    }

    readInputValue(input) {
        if (input.type === 'checkbox') return input.checked;
        if (input.type === 'number') return input.value === '' ? null : Number(input.value);
        return input.value;
    }

    async tryDml(fn, successMessage) {
        this.dirty = true;
        try {
            await fn();
            if (successMessage) this.toast('success', successMessage);
        } catch (e) {
            this.toast('error', this.errorMessage(e));
        } finally {
            this.dirty = false;
        }
    }

    toast(variant, message) {
        this.dispatchEvent(
            new ShowToastEvent({
                title: variant === 'error' ? 'Errore' : 'OK',
                message: String(message),
                variant
            })
        );
    }

    truncate(text, max) {
        if (text == null) return '';
        const t = String(text);
        return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }

    /**
     * Greedy word-wrap into up to `maxLines` lines of `maxChars` each.
     * A single word longer than maxChars is hard-cut. Last line gets an ellipsis
     * if there's still content to render after maxLines.
     */
    wrapText(text, maxChars, maxLines) {
        const t = (text == null ? '' : String(text)).trim();
        if (!t) return ['(empty)'];
        const tokens = [];
        for (const word of t.split(/\s+/)) {
            if (word.length <= maxChars) {
                tokens.push(word);
            } else {
                // hard-cut a too-long word into chunks
                for (let i = 0; i < word.length; i += maxChars) {
                    tokens.push(word.slice(i, i + maxChars));
                }
            }
        }
        const lines = [];
        let current = '';
        let consumed = 0;
        for (const w of tokens) {
            const tentative = current ? current + ' ' + w : w;
            if (tentative.length <= maxChars) {
                current = tentative;
            } else {
                if (current) lines.push(current);
                current = w;
                if (lines.length >= maxLines) break;
            }
            consumed = lines.length * maxChars + current.length;
        }
        if (current && lines.length < maxLines) lines.push(current);
        // Overflow indicator
        const renderedChars = lines.reduce((s, l) => s + l.length, 0);
        if (renderedChars < t.replace(/\s+/g, '').length) {
            const last = lines[lines.length - 1];
            const cut = last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last;
            lines[lines.length - 1] = cut + '…';
        }
        return lines.length ? lines : ['(empty)'];
    }

    titleGeometry(text) {
        const lines = this.wrapText(text, TITLE_MAX_CHARS_PER_LINE, MAX_TITLE_LINES);
        const titleHeight = TITLE_TOP_PAD + lines.length * TITLE_LINE_HEIGHT + TITLE_BOTTOM_PAD;
        return { lines, titleHeight };
    }

    nodeHeightFor(q, rows) {
        const { titleHeight } = this.titleGeometry(q.text);
        return titleHeight + ROW_PAD * 2 + rows.length * ROW_HEIGHT;
    }

    errorMessage(e) {
        if (!e) return 'Errore sconosciuto';
        if (e.body && e.body.message) return e.body.message;
        if (e.body && Array.isArray(e.body) && e.body[0]) return e.body[0].message;
        if (e.message) return e.message;
        return String(e);
    }

    // ---------------- View-model helpers ----------------

    get hasSurvey() {
        return !!this.survey;
    }

    get canvasStyle() {
        return `width: ${this.layout.width}px; height: ${this.layout.height}px;`;
    }

    get validationBlockClass() {
        if (!this.validation) return 'validation-block';
        return (
            'validation-block ' +
            (this.validation.isValid ? 'validation-ok' : 'validation-bad')
        );
    }

    get autoLayoutLabel() {
        return this.autoLayout ? 'Auto-layout: ON' : 'Auto-layout: OFF (drag-and-drop)';
    }
}
