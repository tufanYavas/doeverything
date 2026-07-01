interface QuerySelectorOptions {
  interval?: number;
  document?: ParentNode;
}

export function querySelector<T extends Element>(
  selector: string,
  timeout: number,
  options: QuerySelectorOptions = {},
): Promise<T | null> {
  const { interval = 200, document = window.document } = options;
  if (!document) throw new Error('Document cannot be null!');
  return new Promise(resolve => {
    const startTime = Date.now();

    const intervalId = setInterval(() => {
      const element = document.querySelector<T>(selector);
      if (element) {
        clearInterval(intervalId);
        resolve(element);
      } else if (Date.now() - startTime >= timeout) {
        clearInterval(intervalId);
        resolve(null);
      }
    }, interval);
  });
}

export function querySelectorAll<T extends Element>(
  selector: string,
  timeout: number,
  options: QuerySelectorOptions = {},
): Promise<NodeListOf<T> | null> {
  const { interval = 50, document = window.document } = options;
  if (!document) throw new Error('Document cannot be null!');
  return new Promise(resolve => {
    const startTime = Date.now();

    const intervalId = setInterval(() => {
      const elements = document.querySelectorAll<T>(selector);
      if (elements.length) {
        clearInterval(intervalId);
        resolve(elements);
      } else if (Date.now() - startTime >= timeout) {
        clearInterval(intervalId);
        resolve(null);
      }
    }, interval);
  });
}

export interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
}

export const Keys = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
} as const;

export function pressKey(element: HTMLElement, keyDef: KeyDefinition): void {
  if (!element) {
    console.warn('pressKey: element not found');
    return;
  }

  const eventInit: KeyboardEventInit = {
    key: keyDef.key,
    code: keyDef.code,
    bubbles: true,
    cancelable: true,
    composed: true,
  };

  const dispatchKey = (eventName: string) => {
    const event = new KeyboardEvent(eventName, eventInit);
    Object.defineProperty(event, 'keyCode', { get: () => keyDef.keyCode });
    Object.defineProperty(event, 'which', { get: () => keyDef.keyCode });
    element.dispatchEvent(event);
  };

  dispatchKey('keydown');
  dispatchKey('keypress');
  dispatchKey('keyup');
}

export function simulateTyping(inputElement: HTMLInputElement | HTMLTextAreaElement | HTMLElement, text: string) {
  if (!inputElement) return;

  // Contenteditable elements (div, span, etc.)
  if (!(inputElement instanceof HTMLInputElement) && !(inputElement instanceof HTMLTextAreaElement)) {
    inputElement.focus();
    inputElement.textContent = text;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  const proto =
    inputElement instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  const nativeSetter = descriptor?.set;

  const setValue = (val: string) => {
    if (nativeSetter) {
      nativeSetter.call(inputElement, val);
    } else {
      inputElement.value = val;
    }
  };

  setValue('');
  inputElement.focus();
  inputElement.dispatchEvent(new Event('focus', { bubbles: true }));

  const firstChar = text.charAt(0) || 'a';

  const keydownEvent = new KeyboardEvent('keydown', {
    key: firstChar,
    bubbles: true,
  });
  inputElement.dispatchEvent(keydownEvent);

  const beforeinputEvent = new InputEvent('beforeinput', {
    data: firstChar,
    bubbles: true,
  });
  inputElement.dispatchEvent(beforeinputEvent);

  const keyupEvent = new KeyboardEvent('keyup', {
    key: firstChar,
    bubbles: true,
  });
  inputElement.dispatchEvent(keyupEvent);

  setValue(text);

  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  inputElement.dispatchEvent(new Event('compositionend', { bubbles: true }));

  inputElement.blur();
  inputElement.dispatchEvent(new Event('blur', { bubbles: true }));

  inputElement.dispatchEvent(new Event('change', { bubbles: true }));
}

export function waitForElementChange(
  selector: string,
  parent: HTMLElement | Document = window.document,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const targetNode = parent.querySelector(selector);

    if (!targetNode) {
      reject(new Error('Element not found: ' + selector));
      return;
    }

    const config = { childList: true, attributes: true, subtree: true };

    const observer = new MutationObserver((mutationsList, observer) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList' || mutation.type === 'attributes') {
          observer.disconnect();
          resolve();
          break;
        }
      }
    });

    observer.observe(targetNode, config);
  });
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForTextChange(selector: string, timeout = 30000): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);

    if (!element) {
      reject(new Error(`Element not found for selector: ${selector}`));
      return;
    }

    const oldTextContent = element.textContent;

    const observer = new MutationObserver((mutations, observer) => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          if (element.textContent !== oldTextContent) {
            observer.disconnect();
            resolve(element.textContent);
          }
        }
      });
    });

    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timeout waiting for text change'));
    }, timeout);
  });
}

export function isElementVisible(elem: Element): boolean {
  if (!(elem instanceof Element)) throw new Error('DomUtil: elem is not an element.');

  const style = getComputedStyle(elem);
  if (style.display === 'none') return false;
  if (style.visibility !== 'visible') return false;
  if (parseFloat(style.opacity) < 0.1) return false;

  const rect = elem.getBoundingClientRect();
  if (rect.width + rect.height === 0) return false;

  const elemCenter = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };

  if (elemCenter.x < -1500 || elemCenter.x > (document.documentElement.clientWidth || window.innerWidth) + 1500)
    return false;
  if (elemCenter.y < -5000 || elemCenter.y > (document.documentElement.clientHeight || window.innerHeight) + 5000)
    return false;

  // If perfectly inside the usual viewport, we can reliably use elementFromPoint
  // If it's outside, elementFromPoint will fail (returns null), so we assume it evaluates to true
  // as long as it passed the previous sizing/opacity checks.
  if (
    elemCenter.x >= 0 &&
    elemCenter.x <= (document.documentElement.clientWidth || window.innerWidth) &&
    elemCenter.y >= 0 &&
    elemCenter.y <= (document.documentElement.clientHeight || window.innerHeight)
  ) {
    let pointContainer: Element | null = document.elementFromPoint(elemCenter.x, elemCenter.y);
    while (pointContainer) {
      if (pointContainer === elem) return true;
      pointContainer = pointContainer.parentNode as Element;
    }
    return false;
  }

  return true;
}

export const click = (element?: HTMLElement | null) => {
  if (!element) return;
  const events = [
    new MouseEvent('mouseenter', { bubbles: true, cancelable: true }),
    new MouseEvent('mouseover', { bubbles: true, cancelable: true }),
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: element.getBoundingClientRect().left + 10,
      clientY: element.getBoundingClientRect().top + 10,
    }),
    new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      clientX: element.getBoundingClientRect().left + 10,
      clientY: element.getBoundingClientRect().top + 10,
    }),
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
      detail: 1,
      clientX: element.getBoundingClientRect().left + 10,
      clientY: element.getBoundingClientRect().top + 10,
    }),
  ];

  events.forEach(event => {
    element.dispatchEvent(event);
  });
};

export async function clickAndWaitTextChange(
  clickEl: HTMLElement,
  textChangeSelector: string,
  timeout: number = 15000,
) {
  const wait = waitForTextChange(textChangeSelector, timeout);
  click(clickEl);
  await wait;
}

/**
 * Recursively search for a selector, piercing through open shadow roots.
 */
function querySelectorPiercingShadow(
  selector: string,
  root: Document | Element | ShadowRoot = document,
): HTMLElement | null {
  // Check current root
  let match = root.querySelector<HTMLElement>(selector);
  if (match) return match;

  // Traverse all elements to find shadow roots
  const elements = root.querySelectorAll('*');
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].shadowRoot) {
      match = querySelectorPiercingShadow(selector, elements[i].shadowRoot!);
      if (match) return match;
    }
  }

  return null;
}

/**
 * Finds the first matching container from a list of selectors, traversing shadow DOM if necessary.
 */
export function findTargetContainer(selectors?: string[]): HTMLElement | null {
  if (!selectors || selectors.length === 0) return null;

  for (const selector of selectors) {
    // Fast path: standard query selector
    let container = document.querySelector<HTMLElement>(selector);
    if (container) return container;

    // Slow path: deep shadow root traversal
    container = querySelectorPiercingShadow(selector);
    if (container) return container;
  }

  return null;
}
