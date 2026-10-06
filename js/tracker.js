// js/tracker.js - Multi-Subject Scholarship & Grade Tracker

/**
 * Probability model for scoring a target grade (0-100) on final exam.
 * Clamped by minimum pass threshold (50) and max score (100).
 */
function estimateFinalProbability(needScore, isAdmitted = true) {
    if (!isAdmitted || needScore > 100) return 0.0;
    if (needScore <= 50) return 0.98;

    // Piecewise estimation of final exam score probability
    if (needScore <= 60) {
        return 0.98 - ((needScore - 50) / 10) * 0.08; // 98% -> 90%
    } else if (needScore <= 70) {
        return 0.90 - ((needScore - 60) / 10) * 0.12; // 90% -> 78%
    } else if (needScore <= 80) {
        return 0.78 - ((needScore - 70) / 10) * 0.18; // 78% -> 60%
    } else if (needScore <= 85) {
        return 0.60 - ((needScore - 80) / 5) * 0.15;  // 60% -> 45%
    } else if (needScore <= 90) {
        return 0.45 - ((needScore - 85) / 5) * 0.15;  // 45% -> 30%
    } else if (needScore <= 95) {
        return 0.30 - ((needScore - 90) / 5) * 0.18;  // 30% -> 12%
    } else {
        return 0.12 - ((needScore - 95) / 5) * 0.09;  // 12% -> 3%
    }
}

/**
 * Evaluates a single subject
 */
function evaluateSubject(sub) {
    const rm = Number.isFinite(parseFloat(sub.regmid)) ? parseFloat(sub.regmid) : null;
    const re = Number.isFinite(parseFloat(sub.regend)) ? parseFloat(sub.regend) : null;
    const finalVal = (sub.final !== null && sub.final !== undefined && String(sub.final).trim() !== '' && Number.isFinite(parseFloat(sub.final)))
        ? parseFloat(sub.final)
        : null;

    if (rm === null && re === null) {
        return {
            valid: false,
            name: sub.name || '',
            regterm: 0,
            isAdmitted: true,
            prob70: 1.0,
            prob90: 1.0,
            need70: 50,
            need90: 50,
            hasFinal: false,
            total: 0
        };
    }

    const regmid = rm ?? 0;
    const regend = re ?? 0;
    const regterm = (regmid + regend) / 2;
    const regScore = (regmid * 0.3) + (regend * 0.3);

    // Admission rules
    let isAdmitted = true;
    let blockedReason = '';
    if (regmid < 25) {
        isAdmitted = false;
        blockedReason = 'РегМид < 25';
    } else if (regend < 25) {
        isAdmitted = false;
        blockedReason = 'РегЭнд < 25';
    } else if (regterm < 50) {
        isAdmitted = false;
        blockedReason = 'РегТерм < 50';
    }

    if (!isAdmitted) {
        return {
            valid: true,
            name: sub.name || '',
            regmid,
            regend,
            regterm,
            regScore,
            isAdmitted: false,
            blockedReason,
            hasFinal: finalVal !== null,
            total: finalVal !== null ? (regScore + finalVal * 0.4) : regScore,
            need70: Infinity,
            need90: Infinity,
            prob70: 0.0,
            prob90: 0.0
        };
    }

    if (finalVal !== null) {
        const total = regScore + (finalVal * 0.4);
        const passedCourse = finalVal >= 50 && total >= 50;
        const reached70 = passedCourse && total >= 70;
        const reached90 = passedCourse && total >= 90;

        return {
            valid: true,
            name: sub.name || '',
            regmid,
            regend,
            regterm,
            regScore,
            isAdmitted: true,
            hasFinal: true,
            final: finalVal,
            total,
            need70: finalVal,
            need90: finalVal,
            prob70: reached70 ? 1.0 : 0.0,
            prob90: reached90 ? 1.0 : 0.0
        };
    }

    // Prediction mode
    const rawNeed70 = (70 - regScore) / 0.4;
    const rawNeed90 = (90 - regScore) / 0.4;

    const need70 = Math.max(50, Math.ceil(rawNeed70));
    const need90 = Math.max(50, Math.ceil(rawNeed90));

    const prob70 = estimateFinalProbability(need70, isAdmitted);
    const prob90 = estimateFinalProbability(need90, isAdmitted);

    return {
        valid: true,
        name: sub.name || '',
        regmid,
        regend,
        regterm,
        regScore,
        isAdmitted: true,
        hasFinal: false,
        need70,
        need90,
        rawNeed70,
        rawNeed90,
        prob70,
        prob90
    };
}

/**
 * Calculates overall scholarship chances for an array of subjects
 */
function calculateOverallScholarshipOdds(subjects) {
    if (!Array.isArray(subjects) || subjects.length === 0) {
        return {
            subjectsCount: 0,
            prob70Percent: 0,
            prob90Percent: 0,
            verdictKey: 'tracker_empty_list',
            bottleneck: null,
            results: []
        };
    }

    const results = subjects.map(s => evaluateSubject(s));
    const activeResults = results.filter(r => r.valid);

    if (activeResults.length === 0) {
        return {
            subjectsCount: 0,
            prob70Percent: 0,
            prob90Percent: 0,
            verdictKey: 'tracker_empty_list',
            bottleneck: null,
            results
        };
    }

    // Joint probability = product of all probabilities
    let joint70 = 1.0;
    let joint90 = 1.0;
    let bottleneck = null;
    let minProb = 1.0;

    for (let i = 0; i < activeResults.length; i++) {
        const item = activeResults[i];
        joint70 *= item.prob70;
        joint90 *= item.prob90;

        if (item.prob70 < minProb) {
            minProb = item.prob70;
            bottleneck = item;
        }
    }

    const prob70Percent = Math.round(joint70 * 100);
    const prob90Percent = Math.round(joint90 * 100);

    let verdictKey = 'tracker_verdict_high';
    if (prob70Percent === 0) {
        verdictKey = 'tracker_verdict_lost';
    } else if (prob70Percent < 45) {
        verdictKey = 'tracker_verdict_warning';
    } else if (prob70Percent < 80) {
        verdictKey = 'tracker_verdict_good';
    }

    return {
        subjectsCount: activeResults.length,
        prob70Percent,
        prob90Percent,
        verdictKey,
        bottleneck: minProb < 0.95 ? bottleneck : null,
        results
    };
}

/**
 * Parses LMS / Telegram gradebook output into structured subjects
 * Supports format with "Register Midterm -> XX", "Register Endterm -> YY", "Teacher: ..."
 */
function parseLmsGradeText(text) {
    if (!text || typeof text !== 'string') return [];
    const results = [];
    const allLines = text.split(/\r?\n/);
    const rmIndices = [];

    for (let i = 0; i < allLines.length; i++) {
        if (/Register\s*Midterm/i.test(allLines[i])) rmIndices.push(i);
    }
    if (rmIndices.length === 0) return [];

    const blocks = [];
    for (let k = 0; k < rmIndices.length; k++) {
        const start = (k === 0) ? 0 : Math.max(0, rmIndices[k] - 5);
        const end = (k === rmIndices.length - 1) ? allLines.length : Math.max(0, rmIndices[k + 1] - 5);
        blocks.push(allLines.slice(start, end).join('\n'));
    }

    for (const block of blocks) {
        const rmMatch = block.match(/Register\s*Midterm\s*[-–—>:\s]+(\d+(?:\.\d+)?)/i);
        const reMatch = block.match(/Register\s*Endterm\s*[-–—>:\s]+(\d+(?:\.\d+)?)/i);
        if (!rmMatch && !reMatch) continue;

        const teacherMatch = block.match(/Teacher\s*[:\-]\s*([^\r\n]+)/i);
        const teacher = teacherMatch ? teacherMatch[1].trim() : '';

        const lines = block.split(/\r?\n/).map(s => s.trim());
        let name = '';
        const teacherIdx = lines.findIndex(l => /^Teacher\s*:/i.test(l));
        if (teacherIdx > 0) {
            for (let i = teacherIdx - 1; i >= 0; i--) {
                if (lines[i] && !lines[i].startsWith('/')) {
                    name = lines[i];
                    break;
                }
            }
        }
        if (!name) {
            const rmIdx = lines.findIndex(l => /Register\s*Midterm/i.test(l));
            if (rmIdx > 0) {
                for (let i = rmIdx - 1; i >= 0; i--) {
                    if (lines[i] && !lines[i].startsWith('/') && !lines[i].startsWith('Teacher') && !lines[i].startsWith('Attendance')) {
                        name = lines[i];
                        break;
                    }
                }
            }
        }

        const rm = rmMatch ? parseFloat(rmMatch[1]) : 0;
        const re = reMatch ? parseFloat(reMatch[1]) : 0;
        const rfMatch = block.match(/Register\s*Final\s*[-–—>:\s]+(\d+(?:\.\d+)?)/i);
        const final = (rfMatch && parseFloat(rfMatch[1]) > 0) ? parseFloat(rfMatch[1]) : '';

        results.push({
            id: 'sub_' + Math.random().toString(36).substring(2, 9),
            name: name || 'Subject',
            teacher,
            regmid: rm,
            regend: re,
            final
        });
    }
    return results;
}

// Browser UI Controller
if (typeof window !== 'undefined') {
    const STORAGE_KEY = 'grademaster_tracker_data';

    const defaultSubjectNames = [
        'Advanced Mathematics',
        'Data Structures & Algorithms',
        'Computer Systems Architecture',
        'Academic English',
        'Database Management Systems',
        'Operating Systems'
    ];

    let subjectsState = [];

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(subjectsState));
        } catch {
            // LocalStorage might be disabled or full
        }
    }

    function loadState() {
        // First check URL query parameter
        const urlParams = new URLSearchParams(window.location.search);
        const encoded = urlParams.get('tracker');
        if (encoded) {
            try {
                let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
                while (base64.length % 4) { base64 += '='; }
                const binary = atob(base64);
                const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
                const parsed = JSON.parse(new TextDecoder().decode(bytes));
                if (Array.isArray(parsed) && parsed.length > 0) {
                    subjectsState = parsed;
                    return;
                }
            } catch (err) {
                console.warn('Invalid tracker URL parameter:', err);
            }
        }

        // Otherwise load from LocalStorage
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    subjectsState = parsed;
                    return;
                }
            }
        } catch {
            // fallback
        }

        // Default: 6 empty subjects
        populateDefaultSubjects(false);
    }

    function populateDefaultSubjects(triggerSave = true) {
        subjectsState = defaultSubjectNames.map(name => ({
            id: 'sub_' + Math.random().toString(36).substring(2, 9),
            name: name,
            regmid: '',
            regend: '',
            final: ''
        }));
        if (triggerSave) saveState();
    }

    function addSubject(name = '') {
        const index = subjectsState.length + 1;
        subjectsState.push({
            id: 'sub_' + Math.random().toString(36).substring(2, 9),
            name: name || (getTranslation('subject') + ' ' + index),
            regmid: '',
            regend: '',
            final: ''
        });
        saveState();
        render();
    }

    function removeSubject(id) {
        subjectsState = subjectsState.filter(s => s.id !== id);
        saveState();
        render();
    }

    function clearAll() {
        if (confirm(getTranslation('tracker_clear') + '?')) {
            subjectsState = [];
            saveState();
            render();
        }
    }

    function shareTracker() {
        try {
            const bytes = new TextEncoder().encode(JSON.stringify(subjectsState));
            let binary = '';
            bytes.forEach(byte => { binary += String.fromCharCode(byte); });
            const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
            const shareUrl = `${window.location.origin}${window.location.pathname}?tracker=${encoded}`;

            navigator.clipboard.writeText(shareUrl).then(() => {
                showToast('🔗 Ссылка скопирована в буфер обмена!');
            }).catch(() => {
                prompt('Скопируйте ссылку:', shareUrl);
            });
        } catch {
            alert('Ошибка создания ссылки');
        }
    }

    function showToast(msg) {
        let toast = document.getElementById('shareToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'shareToast';
            toast.className = 'share-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function render() {
        const listContainer = document.getElementById('subjectsList');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        if (subjectsState.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = getTranslation('tracker_empty_list');
            listContainer.appendChild(empty);
        }

        const odds = calculateOverallScholarshipOdds(subjectsState);

        // Update Dashboard Summary
        const gauge70Fill = document.getElementById('gauge70Fill');
        const gauge70Value = document.getElementById('gauge70Value');
        const gauge90Fill = document.getElementById('gauge90Fill');
        const gauge90Value = document.getElementById('gauge90Value');
        const verdictBox = document.getElementById('verdictBox');
        const bottleneckBox = document.getElementById('bottleneckBox');

        if (gauge70Fill && gauge70Value) {
            gauge70Fill.style.width = `${odds.prob70Percent}%`;
            gauge70Value.textContent = `${odds.prob70Percent}%`;
            gauge70Value.className = 'gauge-percentage ' + (odds.prob70Percent >= 75 ? 'chance-high' : odds.prob70Percent >= 45 ? 'chance-medium' : 'chance-low');
            gauge70Fill.className = 'gauge-bar-fill ' + (odds.prob70Percent >= 75 ? 'fill-high' : odds.prob70Percent >= 45 ? 'fill-medium' : 'fill-low');
        }

        if (gauge90Fill && gauge90Value) {
            gauge90Fill.style.width = `${odds.prob90Percent}%`;
            gauge90Value.textContent = `${odds.prob90Percent}%`;
            gauge90Value.className = 'gauge-percentage ' + (odds.prob90Percent >= 75 ? 'chance-high' : odds.prob90Percent >= 45 ? 'chance-medium' : 'chance-low');
            gauge90Fill.className = 'gauge-bar-fill ' + (odds.prob90Percent >= 75 ? 'fill-high' : odds.prob90Percent >= 45 ? 'fill-medium' : 'fill-low');
        }

        if (verdictBox) {
            verdictBox.textContent = getTranslation(odds.verdictKey);
            verdictBox.className = 'verdict-box ' + (
                odds.prob70Percent >= 80 ? 'verdict-success' :
                odds.prob70Percent >= 45 ? 'verdict-warning' :
                'verdict-danger'
            );
        }

        if (bottleneckBox) {
            if (odds.bottleneck && odds.bottleneck.valid) {
                const bName = odds.bottleneck.name || getTranslation('subject');
                if (odds.bottleneck.isAdmitted) {
                    const targetText = odds.bottleneck.need70 > 100 ? '>100 (❌)' : `${odds.bottleneck.need70}`;
                    bottleneckBox.innerHTML = `<span>⚠️ ${getTranslation('tracker_bottleneck_label')}</span> <strong>${escapeHTML(bName)}</strong> — нужно <b>${targetText}</b> на экзамене (шанс: ${Math.round(odds.bottleneck.prob70 * 100)}%)`;
                } else {
                    bottleneckBox.innerHTML = `<span>⚠️ ${getTranslation('tracker_bottleneck_label')}</span> <strong>${escapeHTML(bName)}</strong> — 🚫 <b>Недопуск (${escapeHTML(odds.bottleneck.blockedReason)})</b>`;
                }
                bottleneckBox.style.display = 'flex';
            } else {
                bottleneckBox.style.display = 'none';
            }
        }

        // Render Cards
        subjectsState.forEach((sub, index) => {
            const evalResult = odds.results[index] || evaluateSubject(sub);
            const card = document.createElement('div');
            card.className = 'subject-card';

            let footerHTML = '';
            if (evalResult.valid) {
                const regtermStr = evalResult.regterm.toFixed(1);
                const admittedBadge = evalResult.isAdmitted
                    ? `<span class="metric-pill pill-admitted">✓ ${getTranslation('tracker_status_admitted')} (${regtermStr})</span>`
                    : `<span class="metric-pill pill-blocked">✕ ${getTranslation('tracker_status_blocked')}: ${evalResult.blockedReason}</span>`;

                let target70HTML = '';
                if (!evalResult.isAdmitted) {
                    target70HTML = `<span class="metric-target-70 target-impossible">70+: <strong>✕</strong></span>`;
                } else if (evalResult.hasFinal) {
                    const totalStr = evalResult.total.toFixed(1);
                    const is70 = evalResult.total >= 70;
                    target70HTML = `<span class="metric-target-70 ${is70 ? 'target-easy' : 'target-hard'}">Итоговый балл: <strong>${totalStr}</strong> ${is70 ? '✓' : '✕'}</span>`;
                } else {
                    const need70 = evalResult.need70;
                    const styleClass = need70 > 100 ? 'target-impossible' : need70 <= 60 ? 'target-easy' : need70 <= 80 ? '' : 'target-hard';
                    const displayVal = need70 > 100 ? '>100' : `${need70}`;
                    target70HTML = `<span class="metric-target-70 ${styleClass}">${getTranslation('tracker_need_for_70')}: <strong>${displayVal}</strong></span>`;
                }

                let target90HTML = '';
                if (!evalResult.isAdmitted || evalResult.hasFinal) {
                    target90HTML = '';
                } else {
                    const need90 = evalResult.need90;
                    const displayVal90 = need90 > 100 ? '>100' : `${need90}`;
                    target90HTML = `<span class="metric-target-70">${getTranslation('tracker_need_for_90')}: <strong>${displayVal90}</strong></span>`;
                }

                footerHTML = `
                    <div class="subject-metrics-footer">
                        <div>${admittedBadge}</div>
                        <div style="display: flex; gap: 14px; flex-wrap: wrap;">
                            ${target70HTML}
                            ${target90HTML}
                        </div>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="subject-card-header">
                    <input type="text" class="subject-name-input" value="${escapeHTML(sub.name)}" placeholder="${getTranslation('tracker_subject_name')}" aria-label="${getTranslation('tracker_subject_name')}">
                    <button type="button" class="btn-remove-subject" title="${getTranslation('remove_item')}" aria-label="${getTranslation('remove_item')}">&times;</button>
                </div>
                <div class="subject-inputs-grid">
                    <div class="field-group">
                        <label>${getTranslation('tracker_regmid')}</label>
                        <input type="number" min="0" max="100" class="field-input input-regmid" placeholder="0-100" value="${sub.regmid !== '' ? sub.regmid : ''}">
                    </div>
                    <div class="field-group">
                        <label>${getTranslation('tracker_regend')}</label>
                        <input type="number" min="0" max="100" class="field-input input-regend" placeholder="0-100" value="${sub.regend !== '' ? sub.regend : ''}">
                    </div>
                    <div class="field-group">
                        <label>${getTranslation('tracker_final_optional')}</label>
                        <input type="number" min="0" max="100" class="field-input input-final" placeholder="0-100" value="${sub.final !== '' ? sub.final : ''}">
                    </div>
                </div>
                ${footerHTML}
            `;

            // Event bindings
            const nameInput = card.querySelector('.subject-name-input');
            const rmInput = card.querySelector('.input-regmid');
            const reInput = card.querySelector('.input-regend');
            const finalInput = card.querySelector('.input-final');
            const removeBtn = card.querySelector('.btn-remove-subject');

            nameInput.addEventListener('input', (e) => {
                sub.name = e.target.value;
                saveState();
            });

            const handleScoreInput = () => {
                sub.regmid = rmInput.value.trim();
                sub.regend = reInput.value.trim();
                sub.final = finalInput.value.trim();
                saveState();
                render();
            };

            rmInput.addEventListener('input', handleScoreInput);
            reInput.addEventListener('input', handleScoreInput);
            finalInput.addEventListener('input', handleScoreInput);

            removeBtn.addEventListener('click', () => {
                removeSubject(sub.id);
            });

            listContainer.appendChild(card);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        loadState();
        render();

        document.getElementById('btnAddSubject')?.addEventListener('click', () => addSubject());
        document.getElementById('btnDefaultSubjects')?.addEventListener('click', () => {
            populateDefaultSubjects(true);
            render();
        });
        document.getElementById('btnClearAll')?.addEventListener('click', clearAll);
        document.getElementById('btnShareTracker')?.addEventListener('click', shareTracker);

        // Import Modal Wiring
        const importModal = document.getElementById('importModal');
        const importTextarea = document.getElementById('importTextarea');
        const openImportBtn = document.getElementById('btnOpenImport');
        const closeImportBtn = document.getElementById('btnCloseImport');
        const cancelImportBtn = document.getElementById('btnCancelImport');
        const submitImportBtn = document.getElementById('btnSubmitImport');

        openImportBtn?.addEventListener('click', () => {
            if (importModal) {
                importModal.classList.add('show');
                if (importTextarea) {
                    importTextarea.value = '';
                    importTextarea.focus();
                }
            }
        });

        const closeImport = () => {
            importModal?.classList.remove('show');
        };

        closeImportBtn?.addEventListener('click', closeImport);
        cancelImportBtn?.addEventListener('click', closeImport);
        importModal?.addEventListener('click', (e) => {
            if (e.target === importModal) closeImport();
        });

        submitImportBtn?.addEventListener('click', () => {
            const raw = importTextarea ? importTextarea.value : '';
            const parsed = parseLmsGradeText(raw);
            if (parsed.length > 0) {
                const isOnlyEmpty = subjectsState.every(s => s.regmid === '' && s.regend === '');
                if (isOnlyEmpty) {
                    subjectsState = parsed;
                } else {
                    subjectsState.push(...parsed);
                }
                saveState();
                render();
                closeImport();
                showToast(getTranslation('tracker_import_success', { count: parsed.length }));
            } else {
                alert('Не удалось распознать данные. Убедитесь, что в тексте есть строки Register Midterm / Register Endterm');
            }
        });

        // Track telemetry
        if (typeof window.trackCalculation === 'function') {
            window.trackCalculation('tracker');
        }
    });

    // Re-render when language toggle triggers applyTranslations
    window.addEventListener('languageChanged', render);
}

// Node.js commonjs export for tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        estimateFinalProbability,
        evaluateSubject,
        calculateOverallScholarshipOdds,
        parseLmsGradeText
    };
}
