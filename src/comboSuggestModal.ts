import { App, FuzzyMatch, FuzzySuggestModal, setIcon, Platform } from "obsidian";
import { SuggestItem } from "types";

function removeFocusClasses(button: HTMLElement | null, parent: HTMLElement | null): void {
    if (button) {
        button.removeClass("ore-has-focus");
    }
    if (parent) {
        parent.removeClass("ore-has-focus");
    }
}

/**
 * Unified combobox modal for property and operator selection.
 * Consolidates PropertySuggestModal and OperatorSuggestModal into a single reusable class.
 * Behaviour and styles are disabled on mobile so it works with native controls.
 */
export class ComboboxSuggestModal extends FuzzySuggestModal<SuggestItem> {
    private items: SuggestItem[];
    private selectedValue: string;
    private onSelect: (val: string) => void;
    private anchorEl: HTMLElement | null = null;
    private clickOutsideHandler: ((evt: MouseEvent) => void) | null = null;

    constructor(
        app: App,
        items: SuggestItem[],
        selectedValue: string,
        onSelect: (val: string) => void,
        anchorEl?: HTMLElement
    ) {
        super(app);
        this.items = items;
        this.selectedValue = selectedValue;
        this.onSelect = onSelect;
        if (!Platform.isMobile) {
            this.anchorEl = anchorEl || null;
        }
    }

    getItems(): SuggestItem[] {
        return this.items;
    }

    getItemText(item: SuggestItem): string {
        return item.label;
    }

    onOpen() {
        void super.onOpen();
        //don't do the style and behaviour change on mobile
        if (Platform.isMobile) return;

        // Style modal as combobox
        window.requestAnimationFrame(() => {
            const modalContainer = this.modalEl.closest('.modal-container');
            if (modalContainer) {
                modalContainer.addClass('ore-modal-container');
                modalContainer.removeClass('mod-dim');
                const modalBg = modalContainer.querySelector('.modal-bg');
                if (modalBg) {
                    (modalBg as HTMLElement).addClass('ore-modal-bg-hidden');
                }
            }
        });

        this.modalEl.addClass("ore-suggestion-container", "ore-combobox");

        // Position relative to anchor element
        if (this.anchorEl) {
            const rect = this.anchorEl.getBoundingClientRect();
            this.modalEl.addClass('ore-combobox-positioned');
            // Use CSS custom properties for dynamic positioning (setProperty is acceptable for CSS variables)
            this.modalEl.style.setProperty('--ore-combobox-left', `${rect.left}px`);
            this.modalEl.style.setProperty('--ore-combobox-top', `${rect.bottom + 5}px`);
        }

        // Style input and container
        const promptEl = this.modalEl.querySelector('.prompt-input-container');
        if (promptEl) {
            promptEl.addClass("ore-search-input-container");
            const input = promptEl.querySelector('input');
            if (input) {
                input.setAttribute('type', 'search');
                input.setAttribute('placeholder', 'Search...');

                // Show/hide clear button based on input text
                const updateClearButtonVisibility = () => {
                    const clearButton = promptEl.querySelector('.search-input-clear-button') as HTMLElement;
                    if (clearButton) {
                        if (input.value.trim().length > 0) {
                            clearButton.removeClass('ore-clear-button-hidden');
                            clearButton.addClass('ore-clear-button-visible');
                        } else {
                            clearButton.removeClass('ore-clear-button-visible');
                            clearButton.addClass('ore-clear-button-hidden');
                        }
                    }
                };

                // Initial state - use requestAnimationFrame to ensure DOM is ready
                window.requestAnimationFrame(() => {
                    updateClearButtonVisibility();
                });

                // Update on input change
                input.addEventListener('input', updateClearButtonVisibility);
            }
        }

        const suggestionsEl = this.modalEl.querySelector('.suggestion-container');
        if (suggestionsEl) {
            suggestionsEl.addClass("ore-suggestion");
        }

        // Keep anchor focused
        if (this.anchorEl) {
            if (this.anchorEl.getAttribute('tabindex') === '-1') {
                this.anchorEl.setAttribute('tabindex', '0');
            }
            window.requestAnimationFrame(() => {
                this.anchorEl?.focus();
            });
        }

        // Click-outside handler
        this.clickOutsideHandler = (evt: MouseEvent) => {
            const target = evt.target as Node;
            const isOutsideModal = !this.modalEl.contains(target) && this.modalEl !== target;
            const isNotAnchor = this.anchorEl !== target && !this.anchorEl?.contains(target);
            if (isOutsideModal && isNotAnchor) {
                this.close();
            }
        };

        window.setTimeout(() => {
            document.addEventListener('mousedown', this.clickOutsideHandler!);
        }, 0);
    }

    renderSuggestion(match: FuzzyMatch<SuggestItem>, el: HTMLElement): void {
        const item = match.item;
        el.addClass("ore-suggestion-item", "ore-mod-complex", "ore-mod-toggle");

        if (item.value === this.selectedValue) {
            const checkIcon = el.createDiv({ cls: "ore-suggestion-icon ore-mod-checked" });
            setIcon(checkIcon, "check");
        }

        if (item.icon) {
            const iconDiv = el.createDiv({ cls: "ore-suggestion-icon" });
            const flair = iconDiv.createSpan({ cls: "ore-suggestion-flair" });
            setIcon(flair, item.icon);
        }

        const content = el.createDiv({ cls: "ore-suggestion-content" });
        content.createDiv({ cls: "ore-suggestion-title", text: item.label });
    }

    onChooseItem(item: SuggestItem): void {
        this.onSelect(item.value);
    }

    onClose() {
        if (Platform.isMobile) {
            super.onClose();
            return;
        }
        if (this.clickOutsideHandler) {
            document.removeEventListener('mousedown', this.clickOutsideHandler);
            this.clickOutsideHandler = null;
        }

        // Remove focus class from button and ore-filter-statement
        if (this.anchorEl) {
            // Find the ore-filter-expression element that contains the anchor
            const expression = this.anchorEl.closest('.ore-filter-expression') as HTMLElement;
            removeFocusClasses(this.anchorEl, expression);
        }

        const modalContainer = this.modalEl.closest('.modal-container');
        if (modalContainer) {
            modalContainer.removeClass('ore-modal-container');
            modalContainer.addClass('mod-dim');
            const modalBg = modalContainer.querySelector('.modal-bg');
            if (modalBg) {
                (modalBg as HTMLElement).removeClass('ore-modal-bg-hidden');
            }
        }
        super.onClose();
    }
}