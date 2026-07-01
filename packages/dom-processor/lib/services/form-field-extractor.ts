/**
 * FormFieldExtractor - Extracts form-fillable fields and resolves their labels
 * using the simplified DOM tree from getDOMState.
 *
 * Strategy:
 * 1. Build a simplified DOM tree via DomService + DOMTreeSerializer
 * 2. Flatten the tree into document order
 * 3. Walk the flat list to find form field nodes
 * 4. Resolve labels by scanning preceding text nodes in the flat tree
 *    (shadow DOM boundaries are correctly handled because the serializer
 *    inlines shadow root content into the tree structure)
 * 5. Return FormField objects with resolved labels, choices, and metadata
 */

import { DomService } from './dom-service.js';
import { DOMTreeSerializer } from '../serializer/index.js';
import { NodeType, createEmptyEnhancedNode } from '../types/index.js';
import { findTargetContainer } from '../utils/dom.js';
import type { EnhancedDOMNode, SimplifiedNode, SelectorMap } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * The type of a form field.
 */
export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'date'
  | 'number'
  | 'toggle'
  | 'email'
  | 'tel'
  | 'url'
  | 'password';

const EMPTY_SELECT_TEXTS = [
  'select one',
  'select',
  'choose',
  'please select',
  'please choose',
  'please select one',
  'please choose one',
  'make a selection',
];
/**
 * A detected form field with its resolved label and metadata.
 */
export interface FormField {
  /** The actual DOM element (resolved from the enhanced node) */
  element: HTMLElement | null;
  /** The enhanced DOM node from the simplified tree */
  enhancedNode: EnhancedDOMNode;
  /** Backend node ID used as interactive index (e.g. [42]) */
  backendNodeId: number;
  /** Classified field type */
  fieldType: FormFieldType;
  /** Resolved label text */
  label: string;
  /** How the label was found — useful for debugging */
  labelSource: string;
  /** Placeholder text if present */
  placeholder: string;
  /** Current value of the field */
  value: string;
  /** Available choices for select/radio/checkbox fields */
  choices: string[];
  /** Whether this field is required */
  isRequired: boolean;
  /** HTML name attribute */
  name: string;
  /** HTML id attribute */
  id: string;
  /** Input mode hint (e.g. 'numeric', 'email') */
  inputMode: string;
  /** CSS selector to locate this element */
  selector: string;
  /** Whether this field supports multiple selections (multi-select, checkbox groups) */
  isMultiSelect: boolean;
  /** Stable DOM-persisted identifier (oa-id attribute). Survives React re-renders on same node. */
  oaId: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Input types that are NOT form-fillable. */
const EXCLUDED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset']);

/** Tags that are form-fillable inputs. */
const FORM_FIELD_TAGS = new Set(['input', 'select', 'textarea']);

/** Class patterns indicating a button is a custom select toggle. */
const CUSTOM_SELECT_BUTTON_CLASSES = [
  'fab-SelectToggle', // BambooHR Fabric
  'MuiSelect', // Material UI
  'ant-select', // Ant Design
  'choices__inner', // Choices.js
  'ss-main', // Slim Select
  'ts-control', // Tom Select
];

// ============================================================================
// FormFieldExtractor
// ============================================================================

export class FormFieldExtractor {
  /**
   * Extract all form-fillable fields from the current page.
   *
   * 1. Build simplified DOM tree (same as getDOMState pipeline)
   * 2. Flatten the tree into an ordered list of nodes
   * 3. Identify form field nodes
   * 4. Resolve labels from preceding text nodes in the flat tree
   * 5. Return FormField array
   */
  async extractFormFields(root?: HTMLElement): Promise<FormField[]> {
    // Step 1: Build simplified tree
    const domService = new DomService();
    const rootNode = domService.scanDocument(root);
    const serializer = new DOMTreeSerializer(rootNode, domService);
    const serializedState = serializer.serialize();

    if (!serializedState.root) return [];

    // Step 2: Flatten tree into ordered list
    const flatNodes = this.flattenTree(serializedState.root);

    // Step 3-4: Walk flat list, identify form fields, resolve labels
    const results: FormField[] = [];
    const seenRadioGroups = new Set<string>();

    for (let i = 0; i < flatNodes.length; i++) {
      const sNode = flatNodes[i];
      const original = sNode.originalNode;

      // Only process element nodes
      if (original.nodeType !== NodeType.ELEMENT_NODE) continue;

      // Check if this is a form field
      let fieldType = this.classifyFieldType(original);
      if (!fieldType) continue;

      // Skip disabled fields
      if (original.attributes.disabled !== undefined) continue;
      if (original.attributes['aria-disabled'] === 'true') continue;

      // Deduplicate radio groups
      if (fieldType === 'radio') {
        const name = original.attributes.name || '';
        if (name && seenRadioGroups.has(name)) continue;
        if (name) seenRadioGroups.add(name);
      }

      // Resolve the actual DOM element
      let element = this.findHTMLElement(original);

      // Deduplicate: skip native form elements that are inside a shadow root
      // whose host (or any ancestor host) was already classified as a form field.
      // SPL nests 2+ shadow roots deep: spl-input → shadow → spl-internal → shadow → input
      if (element) {
        let rootNode = element.getRootNode();
        let isDuplicate = false;
        while (rootNode instanceof ShadowRoot) {
          const host = rootNode.host;
          if (host && results.some(r => r.element === host)) {
            isDuplicate = true;
            break;
          }
          rootNode = host.getRootNode();
        }
        if (isDuplicate) continue;
      }

      // Skip elements inside CKEditor wrappers — CKEditor is handled separately in post-processing
      if (element?.closest('.cke[role="application"], .ck-editor[role="application"]')) continue;

      // Custom select override: search input inside a container with aria-haspopup="listbox"
      // (Paycom, rw-widget, etc.) — use the container as the element instead of the input
      if (
        element &&
        fieldType === 'select' &&
        element instanceof HTMLInputElement &&
        element.getAttribute('aria-autocomplete') === 'list'
      ) {
        const selectContainer = element.closest<HTMLElement>('[aria-haspopup="listbox"], [aria-haspopup="true"]');
        if (selectContainer && selectContainer !== element) {
          element = selectContainer;
        }
      }

      // Workday combobox override: text inputs inside multiSelectContainer are selects
      if (
        element &&
        fieldType === 'text' &&
        element.closest('[data-automation-id="multiSelectContainer"], [data-automation-id="formField-dropdown"]')
      ) {
        fieldType = 'select';
      }

      // Visibility check: file inputs and natively-hidden form controls (radio/checkbox)
      // are allowed even if hidden — they're typically replaced with custom styled UI
      const skipVisibilityCheck = fieldType === 'file' || fieldType === 'radio' || fieldType === 'checkbox';
      if (element && !skipVisibilityCheck && !this.isElementVisible(element)) {
        if (
          original.tagName.toLowerCase() === 'select' &&
          element.closest(
            '[data-fabric-component="Select"], .fab-Select, .MuiSelect-root, .ant-select, .choices, .ss-main, .ts-wrapper',
          )
        ) {
          continue;
        }
        continue;
      }

      // Resolve label from preceding text in the flat tree
      const { label, source } = this.resolveLabel(flatNodes, i, original, fieldType);

      // Extract choices
      const choices = await this.extractChoices(element, fieldType, original);

      // For custom select buttons, resolve metadata from paired hidden native <select>
      const isCustomSelect =
        element &&
        (original.tagName.toLowerCase() === 'button' || original.tagName.toLowerCase() === 'div') &&
        fieldType === 'select';

      const resolvedName = original.attributes.name || '';
      const resolvedId = original.attributes.id || '';
      const isRequired = original.attributes.required !== undefined || original.attributes['aria-required'] === 'true';

      // For custom selects, read visible value from button text
      let currentValue = element ? this.getCurrentValue(element) : original.attributes.value || '';
      if (isCustomSelect && element && !currentValue) {
        const contentEl = element.querySelector(
          '.fab-SelectToggle__content, .MuiSelect-select, .ant-select-selection-item, .rw-input',
        );
        if (contentEl) {
          currentValue = contentEl.textContent?.trim() || '';
        } else {
          const ariaLabel = element.getAttribute('aria-label') || '';
          if (ariaLabel && label) {
            const valuePart = ariaLabel.replace(label, '').trim();
            if (valuePart) currentValue = valuePart;
          }
        }
      }

      const finalChoices = choices;

      // Assign stable oa-id to element for cross-scan identity
      let oaId = '';
      if (element) {
        oaId = element.getAttribute('oa-id') || '';
        if (!oaId) {
          oaId = 'oa-' + Math.random().toString(36).substr(2, 9);
          element.setAttribute('oa-id', oaId);
        }
      }

      results.push({
        element,
        enhancedNode: original,
        backendNodeId: original.backendNodeId,
        fieldType,
        label,
        labelSource: source,
        placeholder: original.attributes.placeholder || original.attributes['aria-placeholder'] || '',
        value: currentValue,
        choices: finalChoices,
        isRequired,
        name: resolvedName,
        id: resolvedId,
        inputMode: original.attributes.inputmode || '',
        selector: original.selector || '',
        isMultiSelect: this.isMultiSelectField(element, fieldType, original),
        oaId,
      });
    }

    // Post-processing: CKEditor wrappers (unwrapped by serializer, won't appear in flatNodes)
    const scanRoot = root || document.body;
    const ckeWrappers = this.findCKEditorWrappers(scanRoot);
    for (const wrapper of ckeWrappers) {
      if (results.some(r => r.element === wrapper)) continue;

      const label = this.resolveCKEditorLabel(wrapper);
      const currentValue = this.readCKEditorValue(wrapper);

      let oaId = wrapper.getAttribute('oa-id') || '';
      if (!oaId) {
        oaId = 'oa-' + Math.random().toString(36).substr(2, 9);
        wrapper.setAttribute('oa-id', oaId);
      }

      results.push({
        element: wrapper,
        enhancedNode: createEmptyEnhancedNode(0),
        backendNodeId: 0,
        fieldType: 'richtext',
        label,
        labelSource: 'ckeditor-parent',
        placeholder: '',
        value: currentValue,
        choices: [],
        isRequired: false,
        name: '',
        id: wrapper.id || '',
        inputMode: '',
        selector: wrapper.id ? `#${CSS.escape(wrapper.id)}` : '',
        isMultiSelect: false,
        oaId,
      });
    }

    return results;
  }

  // ========================================================================
  // Form Context Building (for LLM consumption)
  // ========================================================================

  /** Maximum choices to include in context. */
  private static readonly MAX_CHOICES_IN_CONTEXT = 20;

  /**
   * Build a form-focused context string for LLM consumption.
   *
   * Walks the simplified DOM tree to collect surrounding text (section headers,
   * labels, hints) for each form field. The output format matches the
   * browserState interactive element format with question indices.
   *
   * @param fields - The form fields to include (already extracted by extractFormFields)
   */
  buildFormContext(fields: FormField[]): string {
    if (fields.length === 0) return '';

    // Build a fresh simplified tree (DOM may have changed since extraction)
    const domService = new DomService();
    const rootNode = domService.scanDocument();
    const serializer = new DOMTreeSerializer(rootNode, domService);
    const serializedState = serializer.serialize();

    if (!serializedState.root) return this.buildFallbackContext(fields);

    // Flatten with depth info for accurate context collection
    const flatNodes = this.flattenTreeWithDepth(serializedState.root);

    // Build sourceElement → flat index lookup for O(1) matching
    const elementToFlatIndex = new Map<Element, number>();
    for (let i = 0; i < flatNodes.length; i++) {
      const src = flatNodes[i].node.originalNode.sourceElement;
      if (src) elementToFlatIndex.set(src, i);
    }

    const lines: string[] = [];

    // 1. Resolve flat indices for all passed fields to maintain structure
    const fieldNodes = fields.map(ff => {
      let idx = elementToFlatIndex.get(ff.element!) ?? -1;
      if (idx === -1) {
        for (let i = 0; i < flatNodes.length; i++) {
          const n = flatNodes[i].node.originalNode;
          if (n.sourceElement === ff.element) {
            idx = i;
            break;
          }
          if (ff.oaId && n.sourceElement instanceof HTMLElement && n.sourceElement.getAttribute('oa-id') === ff.oaId) {
            idx = i;
            break;
          }
        }
      }
      return { ff, idx };
    });

    // 2. Output fields and the text gaps between them
    for (let qi = 0; qi < fieldNodes.length; qi++) {
      const { ff, idx: nodeIdx } = fieldNodes[qi];
      const el = ff.element;
      if (!el) continue;

      // Find the closest previous field IN THE PASSED LIST
      // This ensures we never skip text that precedes a field, even if it follows
      // a hidden file input or unrendered button.
      let prevNodeIdx = -1;
      if (nodeIdx >= 0) {
        for (let j = 0; j < fieldNodes.length; j++) {
          const otherIdx = fieldNodes[j].idx;
          // Only consider fields rendered before the current one in the DOM
          if (otherIdx >= 0 && otherIdx < nodeIdx && otherIdx > prevNodeIdx) {
            prevNodeIdx = otherIdx;
          }
        }
      }

      // Collect text between the previous field and this field
      if (nodeIdx >= 0) {
        const context = this.collectTreeContext(flatNodes, nodeIdx, prevNodeIdx);
        if (context) {
          // Dedup single-line labels from context against what we are about to output
          const dedupedLines = context
            .split('\n')
            .filter(l => l.trim() !== (ff.label || '').trim())
            .join('\n')
            .trim();
          if (dedupedLines) {
            lines.push(dedupedLines);
          }
        }
      }

      // Also ensure the field's explicit label is output if not caught in context
      if (ff.label) {
        const labelTrimmed = ff.label.trim();
        const lastFewLines = lines.slice(-5).join('\n');
        if (!lastFewLines.includes(labelTrimmed)) {
          lines.push(ff.label);
        }
      }

      // Build field element line with all metadata
      const tag = el.tagName.toLowerCase();
      const attrs: string[] = [];
      if (ff.fieldType !== tag) attrs.push(`type=${ff.fieldType}`);
      if (ff.name) attrs.push(`name=${ff.name}`);
      if (ff.id) attrs.push(`id=${ff.id}`);
      if (ff.placeholder) attrs.push(`placeholder=${ff.placeholder}`);
      if (ff.isRequired) attrs.push('required=true');

      // Re-read the current live value in case the user or another script filled it
      // since the extraction phase began
      let currentValue = ff.value;
      if (el) {
        const liveValue = this.getCurrentValue(el);
        if (liveValue) currentValue = liveValue;
      }

      if (currentValue) attrs.push(`value=${currentValue}`);
      if (ff.isMultiSelect) attrs.push('multiselect=true');
      const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';

      lines.push(`[${qi}]<${tag}${attrStr} />`);

      // Add choices
      let choices = ff.choices;
      if (choices.length === 0 && ff.fieldType === 'select' && el instanceof HTMLSelectElement) {
        choices = Array.from(el.options)
          .map(opt => opt.text.trim())
          .filter(t => t.length > 0);
      }
      // Clean up framework bugs globally (e.g. React props evaluating to object strings)
      choices = choices.filter(c => c !== '[object Object]' && c.trim() !== '');

      if (choices.length > 0) {
        const quote = (c: string) => `"${c}"`;
        const max = FormFieldExtractor.MAX_CHOICES_IN_CONTEXT;
        const choiceStr =
          choices.length <= max
            ? choices.map(quote).join(', ')
            : choices.slice(0, max).map(quote).join(', ') + `, ... (${choices.length - max} more)`;
        lines.push(`  choices: [${choiceStr}]`);
      }
    }

    return lines.join('\n');
  }

  /** Depth-annotated flat node for context collection. */
  private flattenTreeWithDepth(node: SimplifiedNode, depth: number = 0): { node: SimplifiedNode; depth: number }[] {
    const result: { node: SimplifiedNode; depth: number }[] = [{ node, depth }];
    for (const child of node.children) {
      result.push(...this.flattenTreeWithDepth(child, depth + 1));
    }
    return result;
  }

  /**
   * Collect surrounding text context from the depth-annotated flat tree.
   *
   * Two-pass approach to avoid collecting descendant text of the previous
   * interactive element (e.g., <option> texts of a <select>):
   * 1. Walk backward to find the nearest previous interactive element and its depth
   * 2. Walk FORWARD from that element to the current field, collecting only text
   *    nodes at depth <= the previous interactive element's depth (skipping descendants)
   */
  private collectTreeContext(
    flatNodes: { node: SimplifiedNode; depth: number }[],
    fieldIndex: number,
    prevFieldIndex: number,
  ): string {
    const startIdx = prevFieldIndex >= 0 ? prevFieldIndex + 1 : 0;
    const validTexts: string[] = [];

    let inPrevDescendants = prevFieldIndex >= 0;
    const prevDepth = prevFieldIndex >= 0 ? flatNodes[prevFieldIndex].depth : -1;

    for (let i = startIdx; i < fieldIndex; i++) {
      const { node, depth } = flatNodes[i];

      if (inPrevDescendants) {
        if (depth > prevDepth) {
          continue; // Skip descendants of prev field (like select options)
        } else {
          inPrevDescendants = false;
        }
      }

      const original = node.originalNode;
      if (original.nodeType === NodeType.TEXT_NODE) {
        // Honeypot text / Screen reader only text filter
        // If the text node's parent has aria-hidden=true or is off-screen, skip it.
        // TextNodes don't have sourceElement, so trace up parents.
        let p = original.parent;
        let hiddenContainer = false;
        while (p && !hiddenContainer) {
          if (p.nodeType === NodeType.ELEMENT_NODE && p.sourceElement instanceof HTMLElement) {
            const el = p.sourceElement;
            // Skip if aria-hidden
            if (el.closest('[aria-hidden="true"]')) {
              hiddenContainer = true;
              break;
            }
            // Skip if pushed off screen
            const rect = el.getBoundingClientRect();
            if (
              rect.right < 0 ||
              rect.bottom < 0 ||
              rect.left > window.innerWidth ||
              (rect.width <= 1 && rect.height <= 1)
            ) {
              // Elements pushed off screen are bots only
              hiddenContainer = true;
              break;
            }
            break; // Only realistically need to check the closest DOM element as closest() traverses DOM up
          }
          p = p.parent;
        }

        if (hiddenContainer) continue;

        const text = original.textContent?.trim();
        // Avoid tiny noise (e.g. "*", ":") but keep reasonable text
        if (text && text.length > 0 && text !== '*' && text !== ':') {
          validTexts.push(text);
        }
      }
    }

    // Limit to last 30 text elements to prevent context explosion
    // e.g. from massive terms of service blocks
    const maxContextTexts = 30;
    const startIndex = Math.max(0, validTexts.length - maxContextTexts);

    let finalTexts = validTexts.slice(startIndex);
    if (startIndex > 0) {
      finalTexts = ['...', ...finalTexts];
    }

    return finalTexts.join('\n').trim();
  }

  /**
   * Fallback context builder when tree building fails.
   */
  private buildFallbackContext(fields: FormField[]): string {
    const lines: string[] = [];
    for (let i = 0; i < fields.length; i++) {
      const ff = fields[i];
      const el = ff.element;
      if (!el) continue;

      const tag = el.tagName.toLowerCase();
      const attrs: string[] = [];
      if (ff.fieldType !== tag) attrs.push(`type=${ff.fieldType}`);
      if (ff.name) attrs.push(`name=${ff.name}`);
      if (ff.id) attrs.push(`id=${ff.id}`);
      if (ff.placeholder) attrs.push(`placeholder=${ff.placeholder}`);
      if (ff.isRequired) attrs.push('required=true');
      if (ff.value) attrs.push(`value=${ff.value}`);
      if (ff.isMultiSelect) attrs.push('multiselect=true');
      const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';

      if (ff.label) lines.push(ff.label);
      lines.push(`[${i}]<${tag}${attrStr} />`);

      if (ff.choices.length > 0) {
        const quote = (c: string) => `"${c}"`;
        const choiceStr =
          ff.choices.length <= 10
            ? ff.choices.map(quote).join(', ')
            : ff.choices.slice(0, 10).map(quote).join(', ') + `, ... (${ff.choices.length - 10} more)`;
        lines.push(`  choices: [${choiceStr}]`);
      }
    }
    return lines.join('\n');
  }

  // ========================================================================
  // Tree Flattening
  // ========================================================================

  /**
   * Flatten the simplified tree into document order.
   * This gives us a linear sequence where text nodes naturally precede their
   * associated form fields, making label resolution a simple backward scan.
   */
  private flattenTree(node: SimplifiedNode): SimplifiedNode[] {
    const result: SimplifiedNode[] = [];
    this.flattenRecursive(node, result);
    return result;
  }

  private flattenRecursive(node: SimplifiedNode, result: SimplifiedNode[]): void {
    result.push(node);
    for (const child of node.children) {
      this.flattenRecursive(child, result);
    }
  }

  // ========================================================================
  // Label Resolution from Simplified Tree
  // ========================================================================

  /**
   * Resolve the label for a form field by scanning the flat node list backwards.
   *
   * In the simplified tree, labels appear as text nodes (or accessible names)
   * immediately before the form field. We scan backwards from the field's position,
   * collecting text until we hit another interactive element or run out of text.
   *
   * Priority:
   * 1. 'label' attribute (web component convention: <spl-input label="First name">)
   * 2. aria-label attribute
   * 3. Accessibility name (ax-name)
   * 4. Preceding text in the flat tree (backward scan)
   * 5. Placeholder as last resort
   */
  private resolveLabel(
    flatNodes: SimplifiedNode[],
    fieldIndex: number,
    node: EnhancedDOMNode,
    fieldType?: string,
  ): { label: string; source: string } {
    let label: string;
    const isNativeRadioOrCheckbox =
      (fieldType === 'radio' || fieldType === 'checkbox') && node.tagName.toLowerCase() === 'input';
    const isFile = fieldType === 'file';

    // For native radio/checkbox: skip aria-label ("Yes 1 of 2.") since it describes
    // the option, not the question. Jump straight to preceding text collection.
    if (!isNativeRadioOrCheckbox) {
      // 1. Check 'label' attribute (web component convention: <spl-input label="First name">)
      label = (node.attributes.label || '').trim();
      if (label && !(isFile && this.isGenericFileLabel(label)))
        return { label: this.cleanText(label), source: 'label-attr' };

      // 2. Check aria-label attribute
      label = (node.attributes['aria-label'] || '').trim();
      if (label && !(isFile && this.isGenericFileLabel(label))) {
        // Custom select buttons often have aria-label = "Label Value" (e.g. "Country Egypt")
        // Strip the element's visible text content (the selected value) from the end
        const element = this.findHTMLElement(node);
        if (element) {
          const innerText = element.textContent?.trim();
          if (innerText && label.length > innerText.length && label.endsWith(innerText)) {
            const cleanLabel = label.slice(0, -innerText.length).trim();
            if (cleanLabel) label = cleanLabel;
          }
        }
        return { label: this.cleanText(label), source: 'aria-label' };
      }
    }

    // 3. Check accessibility name (covers label[for], aria-labelledby, wrapping label)
    // Skip for native radios — axNode.name is "Yes 1 of 2." (option label, not the question)
    if (!isNativeRadioOrCheckbox && node.axNode?.name) {
      label = node.axNode.name.trim();
      if (label && !(isFile && this.isGenericFileLabel(label)))
        return { label: this.cleanText(label), source: 'ax-name' };
    }

    // 4. Scan backwards in the flat list for preceding text nodes
    // For radios, skip past sibling labels/radios in the same group to find the question
    label = this.collectPrecedingText(
      flatNodes,
      fieldIndex,
      isNativeRadioOrCheckbox ? node.attributes.name : undefined,
      isFile,
    );
    if (label) return { label: this.cleanText(label), source: 'preceding-text' };

    // 5. Placeholder as last resort
    label = (node.attributes.placeholder || node.attributes['aria-placeholder'] || '').trim();
    if (label && !(isFile && this.isGenericFileLabel(label)))
      return { label: this.cleanText(label), source: 'placeholder' };

    return { label: '', source: 'none' };
  }

  /**
   * Check if a label is a generic file input term, often used incorrectly
   * as aria-labels on file inputs or upload buttons (e.g., "file-input", "upload").
   */
  private isGenericFileLabel(text: string): boolean {
    const t = text.trim().toLowerCase();
    return (
      t === 'file-input' ||
      t === 'file input' ||
      t === 'upload' ||
      t.includes('upload file') ||
      t.includes('choose file') ||
      t.includes('attach') ||
      t.includes('browse') ||
      t === 'file' ||
      t === 'document' ||
      t.includes('no file chosen') ||
      t.includes('no file selected')
    );
  }

  /**
   * Collect text from preceding nodes in the flat list.
   *
   * Stop when we hit:
   * - Another interactive element (another field or button — that text belongs to it)
   * - More than 3 consecutive non-text nodes (too far away)
   */
  private collectPrecedingText(
    flatNodes: SimplifiedNode[],
    fieldIndex: number,
    radioGroupName?: string,
    isFile: boolean = false,
  ): string {
    const textParts: string[] = [];
    let nonTextCount = 0;

    for (let i = fieldIndex - 1; i >= 0; i--) {
      const node = flatNodes[i];
      const original = node.originalNode;

      // Stop at another interactive element — unless it's a sibling
      // radio/label in the same group (skip past those to find the question)
      if (node.isInteractive) {
        if (isFile) {
          const btnText = original.textContent?.trim() || '';
          const axName = original.axNode?.name || '';
          if (this.isGenericFileLabel(btnText) || this.isGenericFileLabel(axName)) {
            continue; // Keep scanning backwards past this generic file button
          }
        }

        if (radioGroupName) {
          // Skip past sibling radios in the same group and their wrapping labels
          const tag = original.tagName?.toLowerCase();
          const isGroupSibling = (tag === 'input' && original.attributes.name === radioGroupName) || tag === 'label';
          if (isGroupSibling) continue;
        }
        break;
      }

      // Collect text nodes (skip short option labels like "Yes", "No" inside radio groups)
      if (original.nodeType === NodeType.TEXT_NODE) {
        const text = original.textContent?.trim();

        if (isFile && text) {
          if (this.isGenericFileLabel(text)) {
            continue; // Skip noise text nodes
          }
        }

        // In radio groups, skip short texts that are just option labels
        const minLen = radioGroupName ? 5 : 1;
        if (text && text.length > minLen) {
          textParts.unshift(text);
          nonTextCount = 0; // Reset gap counter
        }
      } else {
        nonTextCount++;
        // Stop if we've passed too many non-text nodes
        // Radio groups need more tolerance (labels, inputs, fieldsets between question and radio)
        if (nonTextCount > (radioGroupName ? 15 : 3)) break;
      }

      // Don't collect too much text (max 3 text segments)
      if (textParts.length >= 3) break;
    }

    return textParts.join(' ').trim();
  }

  // ========================================================================
  // Field Classification
  // ========================================================================

  /**
   * Classify an enhanced node into a FormFieldType, or null if not a form field.
   */
  private classifyFieldType(node: EnhancedDOMNode): FormFieldType | null {
    const tag = node.tagName.toLowerCase();

    // Standard form elements
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';

    // Custom radiogroups
    if (tag === 'sdf-radio-group') return 'radio';
    if (tag === 'sdf-radio-button') return null; // Handled by its parent group

    if (tag === 'saj-chip-list') return 'radio';
    if (tag === 'saj-chip') return null; // Handled by parent group

    if (node.attributes.role === 'radiogroup') return 'radio';
    if (node.attributes.role === 'radio') return null; // Handled by parent group

    // Custom selects
    if (tag === 'sdf-select' || tag === 'sdf-select-simple') return 'select';

    if (tag === 'input') {
      // React-select combobox: treat as select (Greenhouse, etc.)
      if (node.attributes.role === 'combobox') return 'select';

      // Workday searchable dropdown: autocomplete=off + placeholder=Search
      if (node.attributes['aria-autocomplete'] === 'list') return 'select';

      const type = (node.attributes.type || 'text').toLowerCase();
      if (EXCLUDED_INPUT_TYPES.has(type)) return null;

      switch (type) {
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'file':
          return 'file';
        case 'date':
        case 'datetime-local':
        case 'month':
        case 'week':
          return 'date';
        case 'number':
        case 'range':
          return 'number';
        case 'email':
          return 'email';
        case 'tel':
          return 'tel';
        case 'url':
          return 'url';
        case 'password':
          return 'password';
        default:
          return 'text';
      }
    }

    // Custom select buttons (BambooHR Fabric, MUI, Ant Design, etc.)
    if (tag === 'button' || (tag === 'div' && node.attributes.role === 'button')) {
      if (this.isCustomSelectButton(node)) return 'select';
    }

    // iCIMS custom dropdown: <a role="combobox"> with dropdown container
    if (tag === 'a' && node.attributes.role === 'combobox') {
      return 'select';
    }

    // React Widget / generic combobox: <div role="combobox"> with listbox options
    if (tag === 'div' && node.attributes.role === 'combobox') {
      return 'select';
    }

    // contenteditable
    if (node.attributes.contenteditable === 'true' || node.attributes.contenteditable === 'plaintext-only') {
      return 'textarea';
    }

    // Generic shadow host detection: any custom element (tag contains "-")
    // that is a shadow host containing native form elements inside its shadow root.
    // This handles SPL, Salesforce Lightning, and any other web component framework.
    if (tag.includes('-') && node.isShadowHost) {
      return this.classifyShadowHostField(node);
    }

    return null;
  }

  /**
   * Classify a shadow host custom element by inspecting what native form elements
   * exist inside its shadow root. Returns the field type based on the inner element.
   *
   * Compound detection: if the shadow root contains multiple independent
   * sub-components (each a shadow host with their own native form element),
   * return null so each sub-component is classified individually.
   * Example: spl-phone-field contains spl-select (country) + spl-input (number).
   */
  private classifyShadowHostField(node: EnhancedDOMNode): FormFieldType | null {
    const element = node.sourceElement as HTMLElement | undefined;
    if (!element?.shadowRoot) return null;

    // Compound check: count child shadow hosts that contain form elements
    // This handles cases like `spl-phone-field` which contains both a select and an input.
    let formChildCount = 0;
    for (const child of Array.from(element.shadowRoot.querySelectorAll('*'))) {
      if (child.shadowRoot && this.findNativeFormType(child.shadowRoot) !== null) {
        formChildCount++;
        if (formChildCount > 1) return null; // Compound → skip, let children be classified individually
      }
    }

    // Single form element inside → classify normally
    return this.findNativeFormType(element.shadowRoot);
  }

  /**
   * Recursively search shadow roots for native form elements and return their type.
   */
  private findNativeFormType(root: ShadowRoot | DocumentFragment, depth = 0): FormFieldType | null {
    if (depth > 5) return null;

    // Check direct children first
    const select = root.querySelector('select');
    if (select) return 'select';

    const textarea = root.querySelector('textarea');
    if (textarea) return 'textarea';
    const fileInput = root.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (fileInput) return 'file';

    // Check for custom select buttons inside the shadow root (like in spl-select)
    const button = root.querySelector('button') as HTMLButtonElement | null;
    if (button) {
      const haspopup = button.getAttribute('aria-haspopup');
      if (haspopup === 'listbox' || haspopup === 'true') {
        return 'select';
      }
    }

    // Check for custom radio buttons (like sdf-radio-button)
    if (root.querySelector('[role="radio"]')) {
      return 'radio';
    }

    const input = root.querySelector('input') as HTMLInputElement | null;
    if (input) {
      // Combobox / autocomplete inputs are selects (same logic as classifyFieldType)
      if (input.getAttribute('role') === 'combobox') return 'select';
      if (input.getAttribute('aria-autocomplete') === 'list') return 'select';

      const type = (input.type || 'text').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') return null;
      switch (type) {
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'date':
        case 'datetime-local':
        case 'month':
        case 'week':
          return 'date';
        case 'number':
        case 'range':
          return 'number';
        case 'email':
          return 'email';
        case 'tel':
          return 'tel';
        case 'url':
          return 'url';
        case 'password':
          return 'password';
        default:
          return 'text';
      }
    }

    // Recurse into nested shadow roots
    for (const child of Array.from(root.querySelectorAll('*'))) {
      if (child.shadowRoot) {
        const result = this.findNativeFormType(child.shadowRoot, depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Detect if a button/div element is a custom select toggle.
   * Checks class names, data attributes, and aria attributes to identify
   * select-like components (BambooHR Fabric, MUI, Ant Design, etc.).
   */
  private isCustomSelectButton(node: EnhancedDOMNode): boolean {
    const className = node.attributes.class || '';

    // Check button class against known custom select patterns
    for (const pattern of CUSTOM_SELECT_BUTTON_CLASSES) {
      if (className.includes(pattern)) return true;
    }

    // Check data-fabric-component or similar framework hints
    if (node.attributes['data-fabric-component']?.includes('Select')) return true;
    if (node.attributes['data-testid']?.includes('select')) return true;

    // aria-haspopup="true" or "listbox" on a button — common dropdown pattern
    // (Workday, custom selects, etc.)
    const haspopup = node.attributes['aria-haspopup'];
    if (haspopup === 'listbox') return true;
    if (haspopup === 'true' && node.attributes['aria-expanded'] !== undefined) return true;

    // MUI CountryList / combo box: button with aria-label containing "combo box"
    // https://www.paycomonline.net/v4/ats/web.php/portal/28DFB4B7727FCF1D6509E40E49A4A29D/applications#/applications/214417
    const ariaLabel = (node.attributes['aria-label'] || '').toLowerCase();
    if (ariaLabel.includes('combo box') && node.attributes['aria-expanded'] !== undefined) return true;

    return false;
  }

  // ========================================================================
  // Choices Extraction
  // ========================================================================

  /**
   * Extract available choices for select, radio, and checkbox fields.
   */
  private async extractChoices(
    element: HTMLElement | null,
    fieldType: FormFieldType,
    node: EnhancedDOMNode,
  ): Promise<string[]> {
    if (!element) return [];

    if (fieldType === 'select') {
      // https://www.paycomonline.net/v4/ats/web.php/portal/28DFB4B7727FCF1D6509E40E49A4A29D/applications#/applications/214417
      if (element.tagName.toLowerCase() === 'select' && element.closest('.uiLibNativeSelectBase')) {
        return this.extractSelectOptions(element);
      }
      // iCIMS custom dropdown: <a role="combobox"> with li.dropdown-result options
      if (element.tagName.toLowerCase() === 'a' && node.attributes.role === 'combobox') {
        return this.extractIcimsDropdownOptions(element);
      }
      // React-select / rw-widget combobox: extract options via main-script event bridge
      if (
        node.attributes.role === 'combobox' ||
        element.getAttribute('aria-haspopup') === 'listbox' ||
        element.getAttribute('aria-autocomplete') === 'list'
      ) {
        return this.extractReactSelectOptions(element);
      }
      // Custom select button (Fabric, MUI, etc.): use same React Fiber bridge
      // but tag the select container (not the button) for better Fiber traversal
      if (this.isCustomSelectButton(node)) {
        const container =
          element.closest(
            '[data-fabric-component="Select"], [data-fabric-component="SelectField"], .fab-Select, .MuiFormControl-root, .ant-select',
          ) ||
          element.parentElement ||
          element;
        return this.extractReactSelectOptions(container as HTMLElement);
      }
      return this.extractSelectOptions(element);
    }
    if (fieldType === 'radio') {
      return this.extractRadioOptions(element);
    }
    return [];
  }

  /**
   * Extract options from iCIMS custom dropdown.
   * iCIMS uses <a role="combobox"> with a sibling dropdown container
   * containing <li class="dropdown-result"> elements.
   */
  private extractIcimsDropdownOptions(element: HTMLElement): string[] {
    // Find the dropdown container (sibling of the <a> element)
    const parent = element.parentElement;
    if (!parent) return [];

    const container = parent.querySelector('.dropdown-container, [class*="dropdown-results"]');
    if (!container) {
      // Fallback: try to find a paired hidden <select> with actual options
      const hiddenSelect = parent.querySelector('select') as HTMLSelectElement;
      if (hiddenSelect) return this.extractSelectOptions(hiddenSelect);
      return [];
    }

    const items = container.querySelectorAll('li.dropdown-result, li.result-selectable');
    const choices: string[] = [];

    for (const item of Array.from(items)) {
      const text = (item.getAttribute('title') || item.textContent?.trim() || '').trim();
      // Skip placeholder options
      if (!text || text === '— Make a Selection —' || text === '-- Select --') continue;
      choices.push(text);
    }

    return choices;
  }

  /**
   * Extract react-select options via custom event bridge to main-script world.
   * The main-script runs in the page context and can traverse React fiber.
   */
  private async extractReactSelectOptions(element: HTMLElement): Promise<string[]> {
    try {
      return await new Promise<string[]>(resolve => {
        const timeout = setTimeout(() => resolve([]), 500);

        const responseHandler = (event: Event) => {
          const detail = (event as CustomEvent).detail;
          if (detail?.type === 'GetSelectOptionsResponse') {
            clearTimeout(timeout);
            document.removeEventListener('get-select-options-response', responseHandler);
            const options = (detail.options || []).map((o: any) => (typeof o === 'string' ? o : o.text || String(o)));
            if (options.length === 1 && EMPTY_SELECT_TEXTS.includes(options[0].toLowerCase().trim())) {
              resolve([]);
            } else {
              resolve(options);
            }
          }
        };

        document.addEventListener('get-select-options-response', responseHandler);

        // Tag element with oa-id for main-script to find
        let oaId = element.getAttribute('oa-id');
        if (!oaId) {
          oaId = 'oa-' + Math.random().toString(36).substr(2, 9);
          element.setAttribute('oa-id', oaId);
        }

        document.dispatchEvent(
          new CustomEvent('get-select-options', {
            detail: { type: 'GetSelectOptions', selector: `[oa-id="${oaId}"]` },
          }),
        );
      });
    } catch {
      return [];
    }
  }

  private extractSelectOptions(element: HTMLElement): string[] {
    const tagName = element.tagName?.toLowerCase();

    // Handle specific custom selects that have their own defined option elements
    if (tagName === 'spl-select') {
      return this.extractSplSelectOptions(element);
    }
    if ((tagName === 'sdf-select' || tagName === 'sdf-select-simple') && element.shadowRoot) {
      return this.extractSdfSelectOptions(element);
    }

    const select = element as HTMLSelectElement;
    if (tagName !== 'select') {
      // Try shadow root for custom elements wrapping a native select
      if (element.shadowRoot) {
        const inner = element.shadowRoot.querySelector('select') as HTMLSelectElement | null;
        if (inner) return this.getOptionsFromSelect(inner);
      }
      return [];
    }
    return this.getOptionsFromSelect(select);
  }

  private extractSdfSelectOptions(element: HTMLElement): string[] {
    if (!element.shadowRoot) return [];

    const options: string[] = [];

    // Options are nested inside a floating pane
    const pane = element.shadowRoot.querySelector('sdf-floating-pane');
    if (pane) {
      // Check both Light DOM (children of pane) and Shadow Root
      let items = Array.from(pane.querySelectorAll('sdf-select-item'));
      if (items.length === 0 && pane.shadowRoot) {
        items = Array.from(pane.shadowRoot.querySelectorAll('sdf-select-item'));
      }

      for (const item of items) {
        const text = item.getAttribute('aria-label') || item.textContent?.trim() || '';
        if (text && !EMPTY_SELECT_TEXTS.includes(text.toLowerCase())) {
          options.push(text.trim());
        }
      }
    }

    return options;
  }

  private extractSplSelectOptions(element: HTMLElement): string[] {
    // Wait up to 500ms? No, for static analysis we can only read what's currently in DOM.
    // Usually, spl-select-option elements are already in the DOM but hidden styling-wise.
    const optionsNodes = element.querySelectorAll('spl-select-option');
    const options: string[] = [];

    for (const opt of Array.from(optionsNodes)) {
      // Priority: label attribute > textContent
      let text = opt.getAttribute('label') || opt.textContent?.trim() || '';
      text = text
        .replace(/\u00A0/g, ' ')
        .replace(/^\./, '')
        .trim(); // Remove nbsp and leading dots sometimes found in Lit templates

      // Skip empty or placeholder options
      if (!text || EMPTY_SELECT_TEXTS.includes(text.toLowerCase())) continue;

      options.push(text);
    }

    return options;
  }

  private getOptionsFromSelect(select: HTMLSelectElement): string[] {
    const options: string[] = [];
    for (const opt of Array.from(select.options)) {
      const text = opt.textContent?.trim();
      if (text && opt.value !== '') {
        options.push(text);
      }
    }
    return options;
  }

  private extractRadioOptions(element: HTMLElement): string[] {
    // Custom radio groups (e.g. SmartRecruiters sdf-radio-group)
    if (element.tagName.toLowerCase() === 'sdf-radio-group') {
      const radios =
        element.shadowRoot?.querySelectorAll('sdf-radio-button') || element.querySelectorAll('sdf-radio-button');
      return Array.from(radios)
        .map(r => r.getAttribute('label') || r.getAttribute('value') || r.textContent?.trim() || '')
        .filter(Boolean);
    }

    if (element.tagName.toLowerCase() === 'saj-chip-list') {
      const chips = element.querySelectorAll('saj-chip');
      return Array.from(chips)
        .map(c => c.textContent?.trim() || '')
        .filter(Boolean);
    }

    if (element.getAttribute('role') === 'radiogroup') {
      const radios = element.querySelectorAll('[role="radio"]');
      return Array.from(radios)
        .map(r => r.textContent?.trim() || r.getAttribute('aria-label') || '')
        .filter(Boolean);
    }

    const input = element as HTMLInputElement;
    const name = input.name;
    if (!name) return [];

    const radios = document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`);
    const options: string[] = [];

    for (const radio of Array.from(radios)) {
      let text = '';

      if (radio.labels && radio.labels.length > 0) {
        text = radio.labels[0].textContent?.trim() || '';
      }
      if (!text) {
        const next = radio.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          text = next.textContent?.trim() || '';
        }
      }
      if (!text) {
        const nextEl = radio.nextElementSibling as HTMLElement | null;
        if (nextEl && (nextEl.tagName === 'LABEL' || nextEl.tagName === 'SPAN')) {
          text = nextEl.textContent?.trim() || '';
        }
      }

      if (text) options.push(text);
    }
    return options;
  }

  // ========================================================================
  // Multi-Select Detection
  // ========================================================================

  /**
   * Determine if a field supports multiple selections.
   */
  private isMultiSelectField(element: HTMLElement | null, fieldType: FormFieldType, node: EnhancedDOMNode): boolean {
    if (fieldType === 'checkbox') return true;
    if (element instanceof HTMLSelectElement && element.multiple) return true;
    if (node.attributes['aria-multiselectable'] === 'true') return true;

    // React-Select multi-select: ancestor has --is-multi class
    // (e.g. select__value-container--is-multi)
    if (element && fieldType === 'select') {
      if (element.closest('[class*="--is-multi"]')) return true;
    }

    return false;
  }

  // ========================================================================
  // Utilities
  // ========================================================================

  /**
   * Check if an element is visible on screen.
   * Considers display, visibility, dimensions, opacity, and off-screen positioning.
   */
  private isElementVisible(element: HTMLElement): boolean {
    // Fast path: offsetParent is null for display:none elements
    // (except for fixed/sticky positioned elements and body)
    if (!element.offsetParent && element.tagName !== 'BODY') {
      const style = window.getComputedStyle(element);
      if (style.position !== 'fixed' && style.position !== 'sticky') {
        return false;
      }
    }

    const style = window.getComputedStyle(element);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;

    // Opacity 0 — skip for native form elements (radio/checkbox/select etc.)
    // Many sites hide real inputs with opacity:0 and render custom visuals
    if (style.opacity === '0') {
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        )
      ) {
        return false;
      }
    }

    const rect = element.getBoundingClientRect();

    // Zero-size elements (hidden via width/height: < 1)
    // Some sites use 1x1 pixels to hide elements
    if (rect.width <= 1 && rect.height <= 1) {
      // Exceptions: sometimes native radio/checkboxes are hidden as 1x1 to show custom UI
      const isTinyRadioCheckbox =
        element.tagName === 'INPUT' &&
        ((element as HTMLInputElement).type === 'checkbox' || (element as HTMLInputElement).type === 'radio');
      if (!isTinyRadioCheckbox) {
        return false;
      }
    }

    // Honeypot detection via off-screen positioning (e.g. left: -9999px)
    // We use absolute document coordinates, not viewport coordinates (`rect.top` changes when you scroll!)
    const scrollX = window.scrollX || window.pageXOffset;
    const documentLeft = rect.left + scrollX;

    // If it's pushed way off to the left or right of the entire scrollable page, it's a hidden honeypot.
    // We don't check vertical scroll because long forms can be naturally very tall.
    if (documentLeft < -5000 || documentLeft > document.documentElement.scrollWidth + 5000) {
      return false;
    }

    // Accessibility/Honeypot hiding
    // If an element is within an aria-hidden="true" container, it's typically not meant for users.
    // We only enforce this aggressively on text/textarea/number inputs to aviod breaking custom selects.
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (['text', 'email', 'tel', 'number', 'url'].includes(type) || element.tagName === 'TEXTAREA') {
        if (element.closest('[aria-hidden="true"]')) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Find the real HTMLElement from an EnhancedDOMNode.
   */
  private findHTMLElement(node: EnhancedDOMNode): HTMLElement | null {
    // Direct element reference (works for shadow-root-internal elements)
    if (node.sourceElement instanceof HTMLElement) {
      return node.sourceElement;
    }
    if (node.selector) {
      try {
        const el = document.querySelector(node.selector);
        if (el) return el as HTMLElement;
      } catch {
        /* selector might be invalid */
      }
    }
    if (node.xpath) {
      try {
        const result = document.evaluate(node.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue) return result.singleNodeValue as HTMLElement;
      } catch {
        /* xpath might be invalid */
      }
    }
    return null;
  }

  /**
   * Get the current value of a form element.
   */
  private getCurrentValue(element: HTMLElement): string {
    if (element.tagName.toLowerCase() === 'saj-chip-list') {
      const checkedChip = element.querySelector('saj-chip[aria-pressed="true"]');
      return checkedChip?.textContent?.trim() || '';
    }
    if (element.getAttribute('role') === 'radiogroup') {
      const checkedRadio = element.querySelector(
        '[role="radio"][aria-checked="true"], [role="radio"][data-checked="true"]',
      );
      return checkedRadio?.textContent?.trim() || checkedRadio?.getAttribute('aria-label') || '';
    }
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        return element.checked ? 'true' : 'false';
      }
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.options[element.selectedIndex]?.text || element.value;
    }
    if (element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    // CKEditor: read value from DOM (works in isolated world)
    const ckeValue = this.readCKEditorValue(element);
    if (ckeValue) return ckeValue;
    if (element.getAttribute('contenteditable')) {
      return element.textContent?.trim() || '';
    }
    return '';
  }

  /**
   * Clean label text: normalize whitespace, remove noise characters.
   */
  private cleanText(text: string): string {
    return text
      .replace(/[\r\n*✱]/g, '')
      .replace(/"/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Resolve label for a CKEditor instance from its surrounding DOM.
   * Looks for label text in the parent container (preceding <p>, <label>, heading, etc.).
   */
  private resolveCKEditorLabel(ckeWrapper: HTMLElement): string {
    // Strategy 1: Parent container with data-floating-error-notice-type="ckeditor"
    // https://www.paycomonline.net/v4/ats/web.php/portal/28DFB4B7727FCF1D6509E40E49A4A29D/applications#/applications/214417
    const container = ckeWrapper.closest('[data-floating-error-notice-type="ckeditor"]');
    if (container) {
      const labelEl = container.querySelector('p, label, legend, h1, h2, h3, h4, h5, h6');
      if (labelEl) {
        const text = labelEl.textContent?.trim();
        if (text) return this.cleanText(text);
      }
    }

    // Strategy 2: Walk up to find preceding sibling with text
    let current: HTMLElement | null = ckeWrapper.parentElement;
    for (let depth = 0; depth < 3 && current; depth++) {
      const prev = current.previousElementSibling;
      if (prev) {
        const text = prev.textContent?.trim();
        if (text && text.length < 200) return this.cleanText(text);
      }

      const labelEl = current.querySelector('label, legend');
      if (labelEl) {
        const text = labelEl.textContent?.trim();
        if (text) return this.cleanText(text);
      }

      current = current.parentElement;
    }

    // Strategy 3: aria-labelledby on the CKEditor wrapper
    const labelledBy = ckeWrapper.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) {
        const text = labelEl.textContent?.trim();
        if (text) return this.cleanText(text);
      }
    }

    return '';
  }

  /**
   * Find CKEditor wrapper elements (v4 and v5) in the given root.
   * Works in isolated world — uses only DOM selectors.
   */
  private findCKEditorWrappers(root: HTMLElement): HTMLElement[] {
    const wrappers: HTMLElement[] = [];

    // CKEditor 4: div.cke with role="application"
    const cke4 = root.querySelectorAll<HTMLElement>('div.cke[role="application"]');
    wrappers.push(...Array.from(cke4));

    // CKEditor 5: div.ck-editor or .ck-editor__editable
    const ck5 = root.querySelectorAll<HTMLElement>('.ck-editor[role="application"]');
    for (const el of Array.from(ck5)) {
      if (!wrappers.some(w => w.contains(el) || el.contains(w))) {
        wrappers.push(el);
      }
    }

    return wrappers;
  }

  /**
   * Read CKEditor content from DOM (works in isolated world).
   * CKE4: reads iframe body textContent. CKE5: reads contenteditable textContent.
   */
  private readCKEditorValue(wrapper: HTMLElement): string {
    // CKEditor 4: content inside iframe.cke_wysiwyg_frame
    const iframe = wrapper.querySelector('iframe.cke_wysiwyg_frame') as HTMLIFrameElement | null;
    if (iframe?.contentDocument?.body) {
      return iframe.contentDocument.body.textContent?.trim() || '';
    }

    // CKEditor 5: content inside .ck-editor__editable
    const editable = wrapper.querySelector('.ck-editor__editable') as HTMLElement | null;
    if (editable) {
      return editable.textContent?.trim() || '';
    }

    return '';
  }
}
