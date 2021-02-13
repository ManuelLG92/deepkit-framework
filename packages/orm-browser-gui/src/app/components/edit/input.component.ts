import {
    Component,
    ComponentFactoryResolver,
    ComponentRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    Optional,
    Output,
    SimpleChanges,
    ViewContainerRef
} from '@angular/core';
import { TableComponent, unsubscribe } from '@deepkit/desktop-ui';
import { PropertySchema, Types } from '@deepkit/type';
import { Subscription } from 'rxjs';
import { Registry } from '../../registry';

@Component({
    selector: 'orm-browser-property-editing',
    template: ``,
    styles: [`
        :host {
            display: none;
        }
    `]
})
export class InputEditingComponent implements OnDestroy, OnChanges {
    @Input() model: any;
    @Output() modelChange = new EventEmitter();

    @Input() row?: { [name: string]: any };
    @Input() property!: PropertySchema;

    @Input() autoOpen: boolean = true;

    /**
     * To force a different component input type than the one in property
     */
    @Input() type?: Types;

    @Output() done = new EventEmitter<any>();

    protected componentRef?: ComponentRef<any>;
    @unsubscribe()
    protected subDone?: Subscription;
    @unsubscribe()
    protected subKey?: Subscription;
    @unsubscribe()
    protected subChange?: Subscription;

    constructor(
        private registry: Registry,
        private containerRef: ViewContainerRef,
        private resolver: ComponentFactoryResolver,
        @Optional() private table?: TableComponent<any>,
    ) {
    }

    ngOnDestroy() {
        this.unlink();
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes.property || changes.type) this.link();
    }

    protected unlink() {
        this.subDone?.unsubscribe();
        this.subKey?.unsubscribe();
        this.componentRef?.destroy();
    }

    protected link() {
        this.unlink();

        const component = this.registry.inputComponents[this.type || this.property.type];
        if (!component) {
            return;
        }

        const componentFactory = this.resolver.resolveComponentFactory(component);
        this.componentRef = this.containerRef.createComponent(componentFactory);
        this.componentRef.instance.model = this.model;
        this.componentRef.instance.modelChange = this.modelChange;
        this.componentRef.instance.property = this.property;
        this.componentRef.instance.row = this.row;
        this.componentRef.instance.autoOpen = this.autoOpen;

        this.subDone = this.componentRef.instance.done.subscribe(() => {
            if (this.row && this.row.$__activeColumn === this.property.name) this.row.$__activeColumn = undefined;
            this.done.emit(this.row);
        });

        if (this.table) {
            this.subKey = this.componentRef.instance.keyDown.subscribe((event: KeyboardEvent) => {
                if (!this.table || !this.row) return;

                if (event.key.toLowerCase() !== 'tab') return;
                event.preventDefault();
                const currentColumn = this.row.$__activeColumn;
                const currentIndex = this.table.sortedColumnDefs.findIndex(v => v.name === currentColumn);
                if (currentIndex === -1) return;

                if (event.shiftKey) {
                    const next = this.table.sortedColumnDefs[currentIndex - 1];
                    if (next) this.row.$__activeColumn = next.name;
                } else {
                    const next = this.table.sortedColumnDefs[currentIndex + 1];
                    if (next) this.row.$__activeColumn = next.name;
                }
            });
        }
    }
}
