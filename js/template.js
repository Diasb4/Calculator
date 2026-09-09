const PRESET_QUERY_PARAM = 'p';
const LEGACY_PRESET_QUERY_PARAM = 'preset';
const PRESET_SECTIONS = [
    { key: 'assignments', listId: 'assignmentsList', weightId: 'assignmentsWeight' },
    { key: 'quizzes', listId: 'quizzesList', weightId: 'quizzesWeight' },
    { key: 'exams', listId: 'examsList', weightId: 'examsWeight' }
];
const MAX_PRESET_ITEMS_PER_SECTION = 50;
const MAX_PRESET_NAME_LENGTH = 80;

// Добавление нового компонента
function addComponent(sectionId) {
    const section = document.getElementById(sectionId);
    const componentCount = section.querySelectorAll('.component-item').length + 1;

    const componentDiv = createComponentItem();
    const nameInput = componentDiv.querySelector('.component-name');
    nameInput.dataset.defaultKey = getComponentPrefix(sectionId);
    nameInput.dataset.defaultNumber = String(componentCount);
    section.appendChild(componentDiv);
    applyTranslations();
}

// Удаление компонента
function removeComponent(button) {
    const componentItem = button.parentElement;
    componentItem.remove();
    calculateAll(); // Пересчет после удаления
}

// Получение префикса для имени компонента
function getComponentPrefix(sectionId) {
    switch (sectionId) {
        case 'assignmentsList': return 'assignment';
        case 'quizzesList': return 'quiz';
        case 'examsList': return 'exam';
        default: return 'component';
    }
}

function createComponentItem(name = '', grade = '') {
    const componentDiv = document.createElement('div');
    componentDiv.className = 'component-item';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'component-name';
    nameInput.placeholder = name || getTranslation('component');
    nameInput.value = name;
    nameInput.maxLength = MAX_PRESET_NAME_LENGTH;

    const gradeInput = document.createElement('input');
    gradeInput.type = 'number';
    gradeInput.className = 'component-grade';
    gradeInput.dataset.translate = 'grade_range';
    gradeInput.dataset.translateType = 'placeholder';
    translateElement(gradeInput);
    gradeInput.min = '0';
    gradeInput.max = '100';
    gradeInput.value = grade;

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-btn';
    removeButton.type = 'button';
    removeButton.textContent = '×';
    removeButton.dataset.translate = 'remove_item';
    removeButton.dataset.translateType = 'aria-label';
    translateElement(removeButton);
    removeButton.addEventListener('click', function () {
        removeComponent(this);
    });

    componentDiv.append(nameInput, gradeInput, removeButton);
    return componentDiv;
}

function encodePresetData(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    let binary = '';

    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function decodePresetData(encodedData) {
    let base64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');

    while (base64.length % 4) {
        base64 += '=';
    }

    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

function normalizeWeight(value, fallback = 0) {
    const parsedValue = parseInt(value, 10);

    if (Number.isNaN(parsedValue)) {
        return fallback;
    }

    return Math.min(100, Math.max(0, parsedValue));
}

function normalizePresetName(value, fallback = '') {
    if (typeof value !== 'string') {
        return fallback;
    }

    return value.trim().slice(0, MAX_PRESET_NAME_LENGTH) || fallback;
}

function collectPresetData() {
    return PRESET_SECTIONS.map(config => {
        const section = document.getElementById(config.listId);
        const items = Array.from(section.querySelectorAll('.component-item')).map(component => {
            const nameInput = component.querySelector('.component-name');
            return normalizePresetName(nameInput ? nameInput.value : '');
        }).slice(0, MAX_PRESET_ITEMS_PER_SECTION);

        return [
            normalizeWeight(document.getElementById(config.weightId).value),
            items
        ];
    });
}

function applyPresetData(presetData) {
    const sections = Array.isArray(presetData)
        ? presetData
        : PRESET_SECTIONS.map(config => {
            const sectionData = presetData && presetData.version === 1 && presetData.sections
                ? presetData.sections[config.key] || {}
                : {};

            return [
                sectionData.weight,
                Array.isArray(sectionData.items)
                    ? sectionData.items.map(item => item.name)
                    : []
            ];
        });

    if (!Array.isArray(sections) || sections.length === 0) {
        throw new Error('Unsupported preset format');
    }

    PRESET_SECTIONS.forEach((config, sectionIndex) => {
        const sectionData = Array.isArray(sections[sectionIndex]) ? sections[sectionIndex] : [];
        const list = document.getElementById(config.listId);
        const weightInput = document.getElementById(config.weightId);
        const items = Array.isArray(sectionData[1])
            ? sectionData[1].slice(0, MAX_PRESET_ITEMS_PER_SECTION)
            : [];

        weightInput.value = normalizeWeight(sectionData[0], normalizeWeight(weightInput.value));
        list.innerHTML = '';

        if (items.length === 0) {
            list.appendChild(createComponentItem(`${getTranslation(getComponentPrefix(config.listId))} 1`));
            return;
        }

        items.forEach((item, index) => {
            const fallbackName = `${getTranslation(getComponentPrefix(config.listId))} ${index + 1}`;
            const itemName = normalizePresetName(item, fallbackName);
            list.appendChild(createComponentItem(itemName));
        });
    });
}

function setPresetStatus(message, type = 'success') {
    const status = document.getElementById('presetStatus');

    if (!status) return;

    status.dataset.translate = message;
    translateElement(status);
    status.className = `preset-status ${type} show`;
}

function createPresetLink() {
    try {
        const presetData = collectPresetData();
        const encodedPreset = encodePresetData(presetData);
        const presetUrl = new URL(window.location.href);

        presetUrl.searchParams.delete(LEGACY_PRESET_QUERY_PARAM);
        presetUrl.searchParams.set(PRESET_QUERY_PARAM, encodedPreset);
        presetUrl.hash = '';

        document.getElementById('preset-link').value = presetUrl.toString();
        document.getElementById('presetLinkBox').classList.add('show');
        setPresetStatus('preset_saved');
    } catch (error) {
        setPresetStatus('preset_error', 'danger');
    }
}

function copyPresetLink() {
    const presetLinkInput = document.getElementById('preset-link');
    const presetLink = presetLinkInput.value;

    if (!presetLink) {
        createPresetLink();

        if (!presetLinkInput.value) {
            return;
        }
    }

    const linkToCopy = presetLinkInput.value;

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(linkToCopy)
            .then(() => setPresetStatus('link_copied'))
            .catch(copyPresetLinkFallback);
        return;
    }

    copyPresetLinkFallback();
}

function copyPresetLinkFallback() {
    const presetLinkInput = document.getElementById('preset-link');

    presetLinkInput.select();
    presetLinkInput.setSelectionRange(0, 99999);
    try {
        if (!document.execCommand('copy')) throw new Error('Copy failed');
        setPresetStatus('link_copied');
    } catch { setPresetStatus('copy_error', 'danger'); }
}

function loadPresetFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const encodedPreset = urlParams.get(PRESET_QUERY_PARAM) || urlParams.get(LEGACY_PRESET_QUERY_PARAM);

    if (!encodedPreset) return false;

    try {
        applyPresetData(decodePresetData(encodedPreset));
        setPresetStatus('preset_loaded');
        return true;
    } catch (error) {
        setPresetStatus('preset_invalid', 'danger');
        return false;
    }
}

function initializePresetControls() {
    const savePresetButton = document.getElementById('save-preset-btn');
    const copyPresetButton = document.getElementById('copy-preset-btn');

    if (savePresetButton) {
        savePresetButton.addEventListener('click', createPresetLink);
    }

    if (copyPresetButton) {
        copyPresetButton.addEventListener('click', copyPresetLink);
    }
}

// Расчет всех результатов
function calculateAll() {
    // Проверка суммы весов
    const assignmentsWeight = parseInt(document.getElementById('assignmentsWeight').value) || 0;
    const quizzesWeight = parseInt(document.getElementById('quizzesWeight').value) || 0;
    const examsWeight = parseInt(document.getElementById('examsWeight').value) || 0;

    const totalWeight = assignmentsWeight + quizzesWeight + examsWeight;
    const weightError = document.getElementById('weightError');
    const currentWeightSpan = document.getElementById('currentWeight');

    if (totalWeight !== 100) {
        currentWeightSpan.textContent = totalWeight;
        weightError.style.display = 'block';
        return;
    } else {
        weightError.style.display = 'none';
    }

    // Расчет по секциям
    const assignmentsTotal = calculateSection('assignmentsList', assignmentsWeight);
    const quizzesTotal = calculateSection('quizzesList', quizzesWeight);
    const examsTotal = calculateSection('examsList', examsWeight);

    // Общий результат
    const overallTotal = assignmentsTotal + quizzesTotal + examsTotal;

    // Обновление отображения
    document.getElementById('assignmentsTotal').innerHTML = `${translationHTML('assignments')} ${assignmentsTotal.toFixed(2)}`;
    document.getElementById('quizzesTotal').innerHTML = `${translationHTML('quizzes')} ${quizzesTotal.toFixed(2)}`;
    document.getElementById('examsTotal').innerHTML = `${translationHTML('exams')} ${examsTotal.toFixed(2)}`;
    document.getElementById('overallTotal').innerHTML = `${translationHTML('template_overall_result')} ${overallTotal.toFixed(2)}`;

    // Показ результата с оценкой
    showResult(overallTotal);
}

// Расчет одной секции
function calculateSection(sectionId, sectionWeight) {
    const section = document.getElementById(sectionId);
    const components = section.querySelectorAll('.component-item');

    if (components.length === 0) return 0;

    let sectionTotal = 0;
    let validComponents = 0;

    components.forEach(component => {
        const gradeInput = component.querySelector('.component-grade');
        const grade = parseFloat(gradeInput.value);

        if (!isNaN(grade) && grade >= 0 && grade <= 100) {
            sectionTotal += grade;
            validComponents++;
        }
    });

    if (validComponents === 0) return 0;

    // Средняя оценка по секции, умноженная на вес секции
    const averageGrade = sectionTotal / validComponents;
    return averageGrade * (sectionWeight / 100);
}

// Показать итоговый результат
function showResult(totalScore) {
    const resultDiv = document.getElementById('result');

    let status, message, comment;

    if (totalScore >= 90) {
        status = 'success';
        message = `✅ ${translationHTML('template_excellent')}`;
        comment = translationHTML('template_excellent_comment');
    } else if (totalScore >= 70) {
        status = 'success';
        message = `✅ ${translationHTML('template_good')}`;
        comment = translationHTML('template_good_comment');
    } else if (totalScore >= 50) {
        status = 'warning';
        message = `⚠️ ${translationHTML('template_satisfactory')}`;
        comment = translationHTML('template_satisfactory_comment');
    } else {
        status = 'danger';
        message = `❌ ${translationHTML('template_unsatisfactory')}`;
        comment = translationHTML('template_unsatisfactory_comment');
    }

    resultDiv.className = `result ${status} show`;
    resultDiv.innerHTML = `
                <h2>${message}</h2>
                <p>${comment}</p>
                <p class="score">${translationHTML('template_overall_result')} ${totalScore.toFixed(2)}</p>
            `;
}

// Автоматический расчет при изменении оценок
document.addEventListener('input', function (e) {
    if (e.target.classList.contains('component-grade') ||
        e.target.classList.contains('weight-input')) {
        calculateAll();
    }
});


// Инициализация - расчет при загрузке
document.addEventListener('DOMContentLoaded', function () {
    loadPresetFromUrl();
    initializePresetControls();
    document.getElementById('calculate-all-btn').addEventListener('click', calculateAll);
    applyTranslations();
    calculateAll();
});
