/**
 * FormFieldFiller — Fills detected form fields with values.
 *
 * Single Responsibility: Given a FormField and a value, apply the value
 * to the DOM element using the appropriate strategy for the field type.
 *
 * Strategies cover:
 *  - Text inputs (native setter + event dispatch for framework compat)
 *  - Selects (native, React-Select, Workday listbox, combobox)
 *  - Radio buttons (find matching option, click)
 *  - Checkboxes (parse multi-value separator, click matching)
 *  - Textareas (same as text)
 *  - File inputs (DataTransfer API + multi-event dispatch)
 */

import { click, simulateTyping, pressKey, Keys, sleep, querySelector, querySelectorAll } from '../utils/dom.js';
import type { FormField, FormFieldType } from './form-field-extractor.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Fill a single form field with a value.
 * Returns true if the fill was successful.
 */
export async function fillFormField(field: FormField, value: string | string[]): Promise<boolean> {
  const strValue = Array.isArray(value) ? (value[0] ?? '') : value;
  if (!strValue.trim() && field.fieldType !== 'checkbox') return false;

  const element = field.element;
  if (!element) return false;

  const strategy = FILL_STRATEGIES[field.fieldType];
  if (!strategy) return false;

  let success = false;
  try {
    success = await strategy(element, value, field);
  } catch (error) {
    console.error('Fill strategy error:', error);
  }

  // Post-fill verification: wait for framework to process, then check if value stuck
  // Skip for types where value verification doesn't apply
  const skipVerifyTypes: FormFieldType[] = ['checkbox', 'radio', 'select', 'file', 'toggle', 'richtext'];
  if (success && !skipVerifyTypes.includes(field.fieldType)) {
    await sleep(100); // Yield to framework (React/Angular/Vue) event processing
    success = verifyFillResult(element, strValue);
  }

  // Determine which element gets the CSS class marker
  // For react-select combobox, the input is hidden — mark the visible container instead
  const classTarget = resolveClassTarget(element, field.fieldType);

  // Mark filled elements with CSS class (skip checkbox/radio)
  const skipClassTypes: FormFieldType[] = ['checkbox', 'radio'];
  if (!skipClassTypes.includes(field.fieldType)) {
    classTarget.classList.remove('autofilled-by-owlapply', 'not-filled-by-owlapply');
    classTarget.classList.add(success ? 'autofilled-by-owlapply' : 'not-filled-by-owlapply');
  }

  return success;
}

/**
 * Fill a file input with a File object.
 */
export function fillFileInput(element: HTMLElement, file: File): boolean {
  const inputElement = findFileInput(element);
  if (!inputElement) return false;

  const dt = new DataTransfer();
  dt.items.add(file);
  inputElement.files = dt.files;

  dispatchFileEvents(inputElement);
  triggerReactValueTracker(inputElement);

  element.classList.add('autofilled-by-owlapply');
  return true;
}

// ============================================================================
// Strategy Map
// ============================================================================

type FillStrategy = (element: HTMLElement, value: string | string[], field: FormField) => Promise<boolean>;

const FILL_STRATEGIES: Record<FormFieldType, FillStrategy> = {
  text: fillText,
  email: fillText,
  tel: fillText,
  url: fillText,
  password: fillText,
  number: fillText,
  date: fillDate,
  textarea: fillTextarea,
  richtext: fillRichText,
  select: fillSelect,
  radio: fillRadio,
  checkbox: fillCheckbox,
  file: fillFile,
  toggle: fillToggle,
};

// ============================================================================
// Text Strategy
// ============================================================================

async function fillText(element: HTMLElement, value: string | string[]): Promise<boolean> {
  const str = Array.isArray(value) ? (value[0] ?? '') : value;
  const input = resolveInputElement(element) as HTMLInputElement | null;
  if (!input) return false;

  // Lever-style location autocomplete: type → wait for dropdown → click match
  const dropdownContainer = input.parentElement?.querySelector('.dropdown-container');
  if (dropdownContainer) {
    return fillLocationAutocomplete(input, dropdownContainer as HTMLElement, str);
  }

  simulateTyping(input, str);
  return true;
}

/**
 * Fill a Lever-style location autocomplete input.
 * Does NOT use simulateTyping — its blur() closes the dropdown before API results arrive.
 * Strategy: focus → set value → dispatch input event → wait for dropdown → click match.
 */
async function fillLocationAutocomplete(
  input: HTMLInputElement,
  container: HTMLElement,
  value: string,
): Promise<boolean> {
  // Focus without blur — dropdown must stay open for results
  input.focus();
  input.dispatchEvent(new Event('focus', { bubbles: true }));

  // Native setter triggers React's onChange binding (needed to fire the search API)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  }
  // Direct assignment ensures visual update (Lever's UI doesn't reflect native setter alone)
  input.value = value;

  // Full event sequence to trigger search — React listens to input, some sites listen to keyup
  input.dispatchEvent(new KeyboardEvent('keydown', { key: value.charAt(0), bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: value.charAt(0), bubbles: true }));

  // Wait for dropdown location results to render (API call is async)
  const results = await querySelectorAll<HTMLElement>('.dropdown-location', 3000, { document: container });
  if (!results?.length) return true; // Typed but no suggestions

  const options = Array.from(results);

  // Exact match
  for (const opt of options) {
    if (opt.textContent?.trim() === value.trim()) {
      click(opt);
      return true;
    }
  }
  // Normalized match
  for (const opt of options) {
    if (opt.textContent && isNormalizedMatch(opt.textContent.trim(), value)) {
      click(opt);
      return true;
    }
  }
  // Fallback: click first suggestion
  click(options[0]);
  return true;
}

// ============================================================================
// Date Strategy
// ============================================================================

async function fillDate(element: HTMLElement, value: string | string[]): Promise<boolean> {
  const str = Array.isArray(value) ? (value[0] ?? '') : value;
  const input = resolveInputElement(element) as HTMLInputElement | null;
  if (!input) return false;

  setNativeValue(input, str);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// ============================================================================
// Textarea Strategy
// ============================================================================

async function fillTextarea(element: HTMLElement, value: string | string[]): Promise<boolean> {
  const str = Array.isArray(value) ? (value[0] ?? '') : value;
  let textarea: HTMLTextAreaElement | HTMLInputElement | null = null;

  if (element.tagName === 'TEXTAREA') {
    textarea = element as HTMLTextAreaElement;
  } else if (element.tagName.includes('-') && element.shadowRoot) {
    // Custom element with shadow root — find native textarea inside
    textarea = traverseShadowRootsForTextarea(element);
  } else if (element.getAttribute('contenteditable')) {
    element.textContent = str;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  } else {
    textarea = element.querySelector('textarea');
  }

  if (!textarea) return false;

  await simulateTyping(textarea, str);
  return true;
}

// ============================================================================
// Rich Text (CKEditor 4 & 5) Strategy
// ============================================================================

/**
 * Fill a CKEditor (v4 or v5) rich text field.
 * Uses event bridge to call setData() in the page's main world.
 */
async function fillRichText(element: HTMLElement, value: string | string[]): Promise<boolean> {
  const str = Array.isArray(value) ? (value[0] ?? '') : value;

  const oaId = element.getAttribute('oa-id');
  if (!oaId) return false;

  try {
    return await new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => resolve(false), 1500);

      const handler = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.type === 'CKEditorSetDataResponse') {
          clearTimeout(timeout);
          document.removeEventListener('ckeditor-set-data-response', handler);
          resolve(detail.success === true);
        }
      };

      document.addEventListener('ckeditor-set-data-response', handler);
      document.dispatchEvent(
        new CustomEvent('ckeditor-set-data', {
          detail: { type: 'CKEditorSetData', oaId, data: str },
        }),
      );
    });
  } catch {
    return false;
  }
}

// ============================================================================
// Select Strategy
// ============================================================================

async function fillSelect(element: HTMLElement, value: string | string[], field: FormField): Promise<boolean> {
  const values = Array.isArray(value) ? value : [value];

  // 1. Native <select>
  if (element instanceof HTMLSelectElement) {
    return fillNativeSelect(element, values);
  }

  // 2. Workday searchable combobox (input inside multiSelectContainer)
  if (
    element instanceof HTMLInputElement &&
    element.closest('[data-automation-id="multiSelectContainer"], [data-automation-id="formField-dropdown"]')
  ) {
    return fillWorkdayCombobox(element, values[0]);
  }

  // 3. SPL-SELECT (SmartRecruiters): element may be a button inside spl-select's shadow root
  const splSelect = findShadowHostAncestor(element, 'SPL-SELECT');
  if (splSelect) {
    const customResult = await fillSplSelect(splSelect, values[0]);
    if (customResult) return customResult;
  }

  // SDF-SELECT (SmartRecruiters): new version of spl-select
  const sdfSelect =
    findShadowHostAncestor(element, 'SDF-SELECT') || findShadowHostAncestor(element, 'SDF-SELECT-SIMPLE');
  if (sdfSelect) {
    const customResult = await fillSdfSelect(sdfSelect, values[0]);
    if (customResult) return customResult;
  }

  // SPL-AUTOCOMPLETE (SmartRecruiters): element may be an input inside spl-autocomplete's shadow root
  const splAutocomplete = findShadowHostAncestor(element, 'SPL-AUTOCOMPLETE');
  if (splAutocomplete) {
    const customResult = await fillSplAutocomplete(splAutocomplete, values[0]);
    if (customResult) return customResult;
  }

  // 4. MUI CountryList / combo box: button with aria-label containing "combo box"
  // https://www.paycomonline.net/v4/ats/web.php/portal/28DFB4B7727FCF1D6509E40E49A4A29D/applications#/applications/214417
  const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
  if (ariaLabel.includes('combo box') && element.getAttribute('aria-expanded') !== null) {
    return fillMuiComboBox(element, values[0]);
  }

  // 7. iCIMS dropdown — <a role="combobox"> or hidden <select> with icimsdropdown-ajax
  if (
    element.tagName.toLowerCase() === 'a' &&
    element.getAttribute('role') === 'combobox' &&
    element.id?.includes('icimsDropdown')
  ) {
    // Find paired hidden <select> to get its ID for the dropdown container
    const parent = element.parentElement;
    const hiddenSelect = parent?.querySelector('select[icimsdropdown-enabled]') as HTMLElement;
    const searchInput = parent?.querySelector('.dropdown-search') as HTMLInputElement;
    if (hiddenSelect?.id) {
      return fillIcimsDropdown(hiddenSelect, values[0], searchInput, element as HTMLAnchorElement);
    }
  }
  if (element.hasAttribute('icimsdropdown-ajax') && element.id) {
    return fillIcimsDropdown(element, values[0]);
  }

  // 5. Custom select with aria-haspopup (BambooHR Fabric, React-Select, rw-widget, etc.)
  if (
    element.getAttribute('aria-haspopup') ||
    element.getAttribute('aria-autocomplete') === 'list' ||
    element.getAttribute('role') === 'combobox'
  ) {
    if (values.length > 1) {
      return fillReactSelectMulti(element, values);
    }
    return fillReactSelect(element, values[0]);
  }

  // 9. Fallback: try native select inside shadow root
  if (element.shadowRoot) {
    const innerSelect = element.shadowRoot.querySelector('select') as HTMLSelectElement | null;
    if (innerSelect) return fillNativeSelect(innerSelect, values);
  }

  return false;
}

function fillNativeSelect(select: HTMLSelectElement, values: string[]): boolean {
  let filled = false;
  for (let i = 0; i < select.options.length; i++) {
    const optText = select.options[i].text.trim();
    const optValue = select.options[i].value;
    if (values.some(v => isNormalizedMatch(optText, v) || isNormalizedMatch(optValue, v))) {
      select.value = optValue;
      select.options[i].selected = true;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      filled = true;
      if (!select.multiple) break;
    }
  }
  return filled;
}

/**
 * Fill a SmartRecruiters spl-select by finding the matching spl-select-option
 * by label attribute and dispatching composed events for Lit/Angular.
 */
function fillSplSelect(selectElement: HTMLElement, value: string): boolean {
  // Find spl-select-option elements in light DOM and shadow root
  let options = Array.from(selectElement.querySelectorAll<HTMLElement>('spl-select-option'));
  if (options.length === 0 && selectElement.shadowRoot) {
    options = Array.from(selectElement.shadowRoot.querySelectorAll<HTMLElement>('spl-select-option'));
  }
  if (options.length === 0) return false;

  let matchedOption: HTMLElement | null = null;
  let matchedValue = '';

  for (const opt of options) {
    const label = opt.textContent?.trim() || '';
    if (!label) continue;
    if (isNormalizedMatch(label, value)) {
      matchedOption = opt;
      matchedValue = opt.getAttribute('value') || label;
      // Prefer exact match
      if (label.toLowerCase().trim() === value.toLowerCase().trim()) break;
    }
  }
  if (!matchedOption) return false;

  // Force value assignment
  selectElement.setAttribute('value', matchedValue);
  (selectElement as any).value = matchedValue;

  // Composed events to cross shadow DOM boundary → reach Lit/Angular core
  const composedConfig = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  } as MouseEventInit;

  matchedOption.dispatchEvent(new PointerEvent('pointerdown', composedConfig));
  matchedOption.dispatchEvent(new MouseEvent('mousedown', composedConfig));
  matchedOption.dispatchEvent(new MouseEvent('mouseup', composedConfig));
  matchedOption.dispatchEvent(new MouseEvent('click', composedConfig));

  // Form state signals
  selectElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  selectElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  selectElement.dispatchEvent(
    new CustomEvent('spl-change', {
      detail: { value: matchedValue },
      bubbles: true,
      composed: true,
    }),
  );

  return true;
}

/**
 * Fill a SmartRecruiters sdf-select by clicking the trigger button to open
 * the floating pane, then clicking the matching sdf-select-item.
 */
async function fillSdfSelect(selectElement: HTMLElement, value: string): Promise<boolean> {
  if (!selectElement.shadowRoot) return false;

  // 1. Find and click the trigger button to open the dropdown
  const trigger =
    selectElement.shadowRoot.querySelector('[role="button"]') || selectElement.shadowRoot.querySelector('button');
  if (!trigger) return false;

  click(trigger as HTMLElement);
  await sleep(300); // Wait for floating pane to open

  // 2. Find the floating pane and options
  const pane = selectElement.shadowRoot.querySelector('sdf-floating-pane');
  if (!pane) return false;

  // Check both Light DOM (children of pane) and Shadow Root
  let options = Array.from(pane.querySelectorAll<HTMLElement>('sdf-select-item'));
  if (options.length === 0 && pane.shadowRoot) {
    options = Array.from(pane.shadowRoot.querySelectorAll<HTMLElement>('sdf-select-item'));
  }

  if (options.length === 0) return false;

  let matchedOption: HTMLElement | null = null;
  let matchedValue = '';

  for (const opt of options) {
    const label = opt.getAttribute('aria-label') || opt.textContent?.trim() || '';
    if (!label) continue;
    if (isNormalizedMatch(label, value)) {
      matchedOption = opt;
      matchedValue = opt.getAttribute('value') || label;
      // Prefer exact match
      if (label.toLowerCase().trim() === value.toLowerCase().trim()) break;
    }
  }

  if (!matchedOption) {
    // Close it back if no match found
    click(document.body);
    return false;
  }

  // 3. Force value assignment internally
  selectElement.setAttribute('value', matchedValue);
  (selectElement as HTMLSelectElement).value = matchedValue;

  // 4. Click the option (native click usually works best for these items
  // inside listboxes, avoiding pointerdown/mousedown which often triggers
  // the "close-on-click-outside" listener of the floating pane)
  click(matchedOption);

  // 5. Fire change events on the host element
  selectElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  selectElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  selectElement.dispatchEvent(
    new CustomEvent('sdf-change', {
      detail: { value: matchedValue },
      bubbles: true,
      composed: true,
    }),
  );

  return true;
}

/**
 * Fill a SmartRecruiters spl-autocomplete (type-to-search + select from dropdown).
 * Strategy: find inner input → type value char by char → wait for API results →
 * click best matching spl-select-option.
 */
async function fillSplAutocomplete(autocompleteElement: HTMLElement, value: string): Promise<boolean> {
  if (!autocompleteElement.shadowRoot) return false;

  // Find inner spl-input → its shadow root → native <input>
  const splInput = autocompleteElement.shadowRoot.querySelector('spl-input') as HTMLElement | null;
  const nativeInput = splInput?.shadowRoot?.querySelector('input') as HTMLInputElement | null;
  if (!nativeInput) return false;

  // Focus and clear
  nativeInput.focus();
  nativeInput.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, view: window }));
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (!nativeSetter) return false;

  nativeSetter.call(nativeInput, '');
  if (splInput) (splInput as any).value = '';

  simulateTyping(nativeInput, value);

  // Wait for spl-select-option results to appear (API call is async)
  let targetOption: HTMLElement | null = null;
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(200);
    const options = autocompleteElement.shadowRoot.querySelectorAll<HTMLElement>('spl-select-option');
    if (options.length > 0) {
      // Find matching option, exclude manual mode links
      for (const opt of Array.from(options)) {
        const optValue = opt.getAttribute('value') || '';
        if (optValue === 'goToManualLocationMode') continue;
        const text = opt.textContent?.trim() || '';
        if (text && isNormalizedMatch(text, value)) {
          targetOption = opt;
          break;
        }
      }
      if (targetOption) break;
      // If options exist but none match, take the first non-manual option
      if (attempt > 10) {
        for (const opt of Array.from(options)) {
          if (opt.getAttribute('value') !== 'goToManualLocationMode') {
            targetOption = opt;
            break;
          }
        }
        if (targetOption) break;
      }
    }
  }

  if (!targetOption) return true; // Typed but no suggestions appeared

  // Click both inner content div and option for framework compatibility
  const composedConfig = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  } as MouseEventInit;
  const innerContent = targetOption.querySelector('.c-spl-autocomplete-option-content') as HTMLElement | null;
  if (innerContent) {
    innerContent.dispatchEvent(new MouseEvent('mousedown', composedConfig));
    innerContent.dispatchEvent(new MouseEvent('click', composedConfig));
  }

  targetOption.dispatchEvent(new PointerEvent('pointerdown', composedConfig));
  targetOption.dispatchEvent(new MouseEvent('mousedown', composedConfig));
  targetOption.dispatchEvent(new MouseEvent('mouseup', composedConfig));
  targetOption.dispatchEvent(new MouseEvent('click', composedConfig));

  // Close menu and trigger change
  await sleep(150);
  nativeInput.blur();
  nativeInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  return true;
}

async function fillReactSelect(element: HTMLElement, value: string, keepOpen = false): Promise<boolean> {
  if (element.getAttribute('aria-expanded')) {
    const isNotExpanded = element.getAttribute('aria-expanded') === 'false';
    if (isNotExpanded) {
      click(element);
      await sleep(300);
    }
    const isNotExpanded2 = element.getAttribute('aria-expanded') === 'false';
    if (isNotExpanded2) {
      click(element);
      await sleep(300);
    }
  } else {
    click(element);
    await sleep(300);
  }

  const searchInput = element.querySelector('input') || (element.tagName === 'INPUT' ? element : null);
  if (searchInput) {
    simulateTyping(searchInput, value);
    pressKey(searchInput, Keys.Enter);
    await sleep(300);
  }

  // React-select uses aria-controls, rw-widget uses aria-owns
  const listboxId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');

  // Wait for listbox to appear
  const selectors: string[] = [];
  if (listboxId) selectors.push(`#${CSS.escape(listboxId)}`);
  if (element.id) selectors.push(`#${CSS.escape(`react-select-${element.id}-listbox`)}`);
  selectors.push('[role="listbox"]');

  const listbox = await querySelector<HTMLElement>(selectors.join(', '), 1000);

  if (!listbox) return false;

  // Wait for options to render inside listbox
  const options = await querySelectorAll<HTMLElement>(
    'div[id*="option"], [role="option"], [role="menuitem"], [class*="ListItem"]',
    2000,
    { document: listbox },
  );
  if (!options?.length) return false;

  const closeDropdown = () => {
    if (!keepOpen) click(document.body);
  };

  if (element.tagName === 'INPUT' && element.getAttribute('aria-autocomplete') === 'list') {
    click(options[0]);
    closeDropdown();
    return true;
  }

  // Exact match first
  for (const option of Array.from(options)) {
    if (option.textContent?.trim() === value.trim()) {
      click(option);
      closeDropdown();
      return true;
    }
  }
  // Normalized fallback
  for (const option of Array.from(options)) {
    if (option.textContent && isNormalizedMatch(option.textContent.trim(), value)) {
      click(option);
      closeDropdown();
      return true;
    }
  }
  return false;
}

/**
 * Fill a R    -Select multi-select by sel    ng each value sequentially.
     eps dropdown open bet     selec    s.
 */
async function fillReactSelectMulti(element: HTMLElement, values: string[]): Promise<boolean> {
  let filled = false;
  for (let i = 0; i < values.length; i++) {
    const isLast = i === values.length - 1;
    const success = await fillReactSelect(element, values[i], !isLast);
    if (success) filled = true;
    if (!isLast) await sleep(300); // Wait for DOM to update between selections
  }
  return filled;
}

/**
 * Fill a Workday searchable combobox (input inside multiSelectContainer).
 * Strategy: click → type value → Enter.
 */
async function fillWorkdayCombobox(input: HTMLInputElement, value: string): Promise<boolean> {
  click(input);
  simulateTyping(input, value);
  pressKey(input, Keys.Enter);
  return true;
}

/**
 * Fill a MUI CountryList / combo box.
 * Strategy: click button → type in search input → click first matching <li>.
 * https://www.paycomonline.net/v4/ats/web.php/portal/28DFB4B7727FCF1D6509E40E49A4A29D/applications#/applications/214417
 */
async function fillMuiComboBox(button: HTMLElement, value: string): Promise<boolean> {
  // Open the dropdown
  click(button);

  // Find the search input in the popup (MUI uses data-testid="searchsearchinput")
  const searchInput = await querySelector<HTMLInputElement>('input[data-testid="searchsearchinput"]', 2000);
  if (!searchInput) return false;

  // Type the value to filter the list
  searchInput.focus();
  simulateTyping(searchInput, value);
  await sleep(800); // Wait for list to filter

  // Find matching <li> items in the dropdown
  const items = document.querySelectorAll<HTMLLIElement>('li[data-testid^="country-list-item"]');

  // Exact match first
  for (const item of Array.from(items)) {
    const text = item.textContent?.trim();
    if (text && text.toLowerCase() === value.toLowerCase()) {
      click(item);
      click(document.body);
      return true;
    }
  }
  // Normalized match
  for (const item of Array.from(items)) {
    const text = item.textContent?.trim();
    if (text && isNormalizedMatch(text, value)) {
      click(item);
      click(document.body);
      return true;
    }
  }
  // Fallback: click first visible item
  if (items.length > 0) {
    click(items[0]);
    click(document.body);
    return true;
  }
  return false;
}

async function fillIcimsDropdown(
  element: HTMLElement,
  value: string,
  searchInput?: HTMLInputElement,
  aElement?: HTMLAnchorElement,
): Promise<boolean> {
  // Use getElementById to avoid CSS selector escaping issues with iCIMS IDs
  // (e.g., "-1_PersonProfileFields.AddressCountry" contains leading dash and dots)
  const container = document.getElementById(`${element.id}_icimsDropdown_ctnr`);
  if (!container) return false;

  const items = container.querySelectorAll<HTMLLIElement>('li');
  for (const item of Array.from(items)) {
    const text = item.textContent?.trim();
    if (text && isNormalizedMatch(text, value)) {
      item.click();
      return true;
    }
  }

  // Not found — options may be AJAX-loaded on search.
  // Type into search input and trigger iCIMS keyup handler.
  if (searchInput && aElement) {
    click(aElement);
    await sleep(200);

    searchInput.focus();
    searchInput.value = value;

    // iCIMS search listens to keyup events (jQuery-based)
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(
      new KeyboardEvent('keyup', {
        bubbles: true,
        key: value.slice(-1),
        code: 'Key' + value.slice(-1).toUpperCase(),
      }),
    );
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

    // Wait for AJAX results
    await sleep(2000);

    const items = container.querySelectorAll<HTMLLIElement>('li');
    for (const item of Array.from(items)) {
      const text = item.textContent?.trim();
      if (text && isNormalizedMatch(text, value)) {
        item.click();
        return true;
      }
    }
  }
  return false;
}

// ============================================================================
// Radio Strategy
// ============================================================================

async function fillRadio(element: HTMLElement, value: string | string[]): Promise<boolean> {
  const str = Array.isArray(value) ? (value[0] ?? '') : value;

  // Custom radio groups (e.g. SmartRecruiters sdf-radio-group)
  if (element.tagName.toLowerCase() === 'sdf-radio-group') {
    const radios =
      element.shadowRoot?.querySelectorAll('sdf-radio-button') || element.querySelectorAll('sdf-radio-button');
    for (const radio of Array.from(radios)) {
      const radioLabel = radio.getAttribute('label') || radio.getAttribute('value') || radio.textContent?.trim() || '';
      if (radioLabel && isNormalizedMatch(radioLabel, str)) {
        click(radio as HTMLElement);
        return true;
      }
    }
    return false;
  }

  if (element.tagName.toLowerCase() === 'saj-chip-list') {
    const chips = element.querySelectorAll('saj-chip');
    for (const chip of Array.from(chips)) {
      const chipLabel = chip.textContent?.trim() || '';
      if (chipLabel && isNormalizedMatch(chipLabel, str)) {
        click(chip as HTMLElement);
        return true;
      }
    }
    return false;
  }

  if (element.getAttribute('role') === 'radiogroup') {
    const radios = element.querySelectorAll('[role="radio"]');
    for (const radio of Array.from(radios)) {
      const radioLabel = radio.textContent?.trim() || radio.getAttribute('aria-label') || '';
      if (radioLabel && isNormalizedMatch(radioLabel, str)) {
        click(radio as HTMLElement);
        return true;
      }
    }
    return false;
  }

  const input = element as HTMLInputElement;
  const name = input.name;
  if (!name) return false;

  const radios = document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`);

  for (const radio of Array.from(radios)) {
    const radioLabel = getRadioLabel(radio);
    if (radioLabel && radioLabel.trim() === str.trim()) {
      click(radio);
      return true;
    }
  }
  // Normalized fallback
  for (const radio of Array.from(radios)) {
    const radioLabel = getRadioLabel(radio);
    if (radioLabel && isNormalizedMatch(radioLabel, str)) {
      click(radio);
      return true;
    }
  }
  return false;
}

function getRadioLabel(radio: HTMLInputElement): string {
  // 1. Explicit <label> via `labels` property
  if (radio.labels && radio.labels.length > 0) {
    const text = radio.labels[0].textContent?.trim();
    if (text) return text;
  }
  // 2. Next text sibling
  const next = radio.nextSibling;
  if (next?.nodeType === Node.TEXT_NODE) {
    const text = next.textContent?.trim();
    if (text) return text;
  }
  // 3. Next element sibling (label/span)
  const nextEl = radio.nextElementSibling as HTMLElement | null;
  if (nextEl && (nextEl.tagName === 'LABEL' || nextEl.tagName === 'SPAN')) {
    const text = nextEl.textContent?.trim();
    if (text) return text;
  }
  // 4. Closest label parent
  const parentLabel = radio.closest('label');
  if (parentLabel) {
    // Get direct text nodes only (exclude nested input text)
    const walker = document.createTreeWalker(parentLabel, NodeFilter.SHOW_TEXT);
    let text = '';
    let node: Node | null;
    while ((node = walker.nextNode())) {
      text += node.textContent?.trim() || '';
    }
    if (text) return text;
  }
  return '';
}

// ============================================================================
// Checkbox Strategy
// ============================================================================

async function fillCheckbox(element: HTMLElement, value: string | string[], field: FormField): Promise<boolean> {
  const targets = Array.isArray(value) ? value : [value];

  // Single checkbox with same label as question → just check it
  if (field.choices.length <= 1 && targets.length === 1) {
    const cb = element as HTMLInputElement;
    if (!cb.checked) click(cb);
    return true;
  }

  // Multi-checkbox: find all with same name
  const input = element as HTMLInputElement;
  const name = input.name;
  const checkboxes = name
    ? document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${CSS.escape(name)}"]`)
    : findNearbyCheckboxes(element);

  let filled = false;
  for (const cb of Array.from(checkboxes)) {
    const cbLabel = getRadioLabel(cb); // Same label resolution works for checkboxes
    const shouldCheck = targets.some(t => cbLabel && (cbLabel.trim() === t || isNormalizedMatch(cbLabel, t)));

    if (shouldCheck && !cb.checked) {
      click(cb);
      filled = true;
    } else if (!shouldCheck && cb.checked) {
      click(cb); // uncheck
    }
  }
  return filled;
}

function findNearbyCheckboxes(element: HTMLElement): HTMLInputElement[] {
  const container = element.closest('fieldset') || element.closest('ul') || element.closest('div');
  if (!container) return [element as HTMLInputElement];
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
}

// ============================================================================
// File Strategy
// ============================================================================

async function fillFile(_element: HTMLElement, _value: string | string[]): Promise<boolean> {
  // File filling is handled separately via fillFileInput() since it needs
  // a File object, not a string value.
  return false;
}

// ============================================================================
// Toggle Strategy
// ============================================================================

async function fillToggle(element: HTMLElement, value: string | string[]): Promise<boolean> {
  const str = Array.isArray(value) ? (value[0] ?? '') : value;
  const shouldBeOn = ['true', 'yes', 'on', '1'].includes(str.toLowerCase().trim());
  const isOn = element.getAttribute('aria-checked') === 'true' || (element as HTMLInputElement).checked === true;

  if (shouldBeOn !== isOn) {
    click(element);
  }
  return true;
}

// ============================================================================
// DOM Utilities
// ============================================================================

/**
 * Find the best element to receive the CSS class marker.
 * For react-select combobox, the <input> is tiny/hidden inside the component,
 * so we traverse up to find the visible container div.
 */
function resolveClassTarget(element: HTMLElement, fieldType: FormFieldType): HTMLElement {
  if (fieldType === 'select' && element.getAttribute('role') === 'combobox') {
    // React-select structure: container > __control > __value-container > input
    // Walk up max 4 levels to find a visible container
    let current: HTMLElement | null = element;
    for (let i = 0; i < 4 && current; i++) {
      current = current.parentElement;
      if (!current) break;

      // Found a react-select container (has class with 'control' or is a wrapper div)
      const cls = current.className || '';
      if (typeof cls === 'string' && (cls.includes('control') || cls.includes('select'))) {
        return current;
      }
    }
  }
  return element;
}

/**
 * Resolve the actual fillable input element, traversing shadow roots if needed.
 * Handles any custom element with shadow roots containing native inputs.
 */
function resolveInputElement(element: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  const tag = element.tagName;

  // Standard inputs
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element;
  }

  // Custom elements with shadow roots (any web component)
  if (tag.includes('-') && element.shadowRoot) {
    return traverseShadowRootsForInput(element);
  }

  // Generic fallback: try finding input inside
  return element.querySelector('input') || element.querySelector('textarea');
}

function traverseShadowRootsForInput(element: Element): HTMLInputElement | null {
  if (!element.shadowRoot) return null;

  const directInput = element.shadowRoot.querySelector('input') as HTMLInputElement | null;
  if (directInput) return directInput;

  // Deeper traversal
  for (const child of Array.from(element.shadowRoot.querySelectorAll('*'))) {
    if (child.shadowRoot) {
      const nested = traverseShadowRootsForInput(child);
      if (nested) return nested;
    }
  }
  return null;
}

function traverseShadowRootsForTextarea(element: Element): HTMLTextAreaElement | null {
  if (!element.shadowRoot) return null;

  const direct = element.shadowRoot.querySelector('textarea') as HTMLTextAreaElement | null;
  if (direct) return direct;

  for (const child of Array.from(element.shadowRoot.querySelectorAll('*'))) {
    if (child.shadowRoot) {
      const nested = traverseShadowRootsForTextarea(child);
      if (nested) return nested;
    }
  }
  return null;
}

function findFileInput(element: HTMLElement): HTMLInputElement | null {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    return element;
  }
  // Generic fallback: check shadow root then children
  if (element.shadowRoot) {
    const inner = element.shadowRoot.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (inner) return inner;
  }
  return element.querySelector('input[type="file"]');
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function dispatchFileEvents(element: HTMLInputElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function triggerReactValueTracker(element: HTMLInputElement): void {
  if ((element as any)._valueTracker) {
    (element as any)._valueTracker.setValue?.('');
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Verify that the fill actually persisted after framework processing.
 * Reads back the current value and checks it's not empty/different.
 */
function verifyFillResult(element: HTMLElement, expectedValue: string): boolean {
  const actual = readCurrentValue(element);

  // If the field is now empty, framework rejected the value
  if (!actual.trim()) return false;

  // Normalize for comparison (framework may format: e.g. phone numbers, currency)
  const normalizedActual = actual.toLowerCase().replace(/[\s\-\(\)]/g, '');
  const normalizedExpected = expectedValue.toLowerCase().replace(/[\s\-\(\)]/g, '');

  // Check if actual contains significant portion of expected value
  // (allows for framework formatting like "123-456-7890" vs "1234567890")
  if (normalizedActual.length === 0) return false;
  if (normalizedActual === normalizedExpected) return true;
  if (normalizedActual.includes(normalizedExpected) || normalizedExpected.includes(normalizedActual)) return true;

  // At minimum, the field should not be empty after fill
  return actual.trim().length > 0;
}

/**
 * Read the current value of any form element (input, textarea, contenteditable, custom).
 * Traverses shadow roots to find native form elements inside custom components.
 */
function readCurrentValue(element: HTMLElement): string {
  // 1. Try resolving inner input/textarea via shadow roots (same logic as fillText)
  const inner = resolveInputElement(element);
  if (inner && (inner instanceof HTMLInputElement || inner instanceof HTMLTextAreaElement)) {
    return inner.value;
  }

  // 2. Direct native elements
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  if (element instanceof HTMLSelectElement) {
    return element.options[element.selectedIndex]?.text || element.value;
  }
  if (element.getAttribute('contenteditable')) {
    return element.textContent?.trim() || '';
  }

  // 3. Custom element: try textarea inside shadow root (for fillTextarea cases)
  if (element.tagName.includes('-') && element.shadowRoot) {
    const textarea = traverseShadowRootsForTextarea(element);
    if (textarea) return textarea.value;
  }

  // 4. CKEditor: read value from DOM (CKE4: iframe body, CKE5: contenteditable)
  const iframe = element.querySelector('iframe.cke_wysiwyg_frame') as HTMLIFrameElement | null;
  if (iframe?.contentDocument?.body) {
    return iframe.contentDocument.body.textContent?.trim() || '';
  }
  const ckEditable = element.querySelector('.ck-editor__editable') as HTMLElement | null;
  if (ckEditable) {
    return ckEditable.textContent?.trim() || '';
  }

  // 5. Last resort: check the element's value property (some custom elements expose it)
  if ('value' in element && typeof (element as any).value === 'string') {
    return (element as any).value;
  }

  return '';
}

function isNormalizedMatch(optionText: string, value: string): boolean {
  const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/gi, '');
  const normalized = strip(optionText);
  const normalizedValue = strip(value);
  if (!normalized || !normalizedValue) return false;
  return (
    normalized === normalizedValue || normalized.startsWith(normalizedValue) || normalized.includes(normalizedValue)
  );
}

/** Walk up shadow root host chain to find an ancestor with the given tag name. */
function findShadowHostAncestor(element: HTMLElement, tagName: string): HTMLElement | null {
  let node: Node = element;
  while (node) {
    if (node instanceof HTMLElement && node.tagName === tagName) return node;
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) {
      node = root.host;
    } else {
      break;
    }
  }
  return null;
}
