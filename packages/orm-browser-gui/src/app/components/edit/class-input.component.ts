import {
    AfterViewInit,
    ChangeDetectorRef,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    Optional,
    Output,
    SkipSelf
} from '@angular/core';
import { arrayRemoveItem } from '@deepkit/core';
import { DuiDialog, ReactiveChangeDetectionModule } from '@deepkit/desktop-ui';
import { ClassSchema, getPrimaryKeyHashGenerator, jsonSerializer, PropertySchema } from '@deepkit/type';
import { BrowserState } from 'src/app/browser-state';

@Component({
    template: `
        <ng-container *ngIf="!open">
            Undefined
        </ng-container>
        <dui-dialog *ngIf="jsonEditor" class="class-field-dialog" noPadding [visible]="true" (closed)="done.emit()" [backDropCloses]="true"
                    [minWidth]="450" [minHeight]="350">
            <div class="json-editor">
                <h3>JSON</h3>
                <dui-input type="textarea" [(ngModel)]="jsonContent"></dui-input>
            </div>
            <dui-dialog-actions>
                <dui-button closeDialog>Cancel</dui-button>
                <dui-button (click)="jsonDone()">Ok</dui-button>
            </dui-dialog-actions>
        </dui-dialog>
        <dui-dialog *ngIf="!parent && open" class="class-field-dialog" noPadding [backDropCloses]="true"
                    [visible]="browserStack.length > 0" (closed)="done.emit(); open = false" minWidth="80%"
                    minHeight="60%">
            <div class="layout">
                <div class="header" *ngIf="state.database && foreignSchema">
            <span *ngFor="let browser of browserStack">
                 &raquo; {{browser.foreignSchema?.getClassName()}}
            </span>
                </div>

                <!-- <ng-container *ngIf="state.database && entity && browserStack.length === 0">
                    <orm-browser-database-browser
                    [dialog]="true"
                    [selectedPkHashes]="selectedPkHashes"
                    [multiSelect]="property.isArray"
                    (select)="onSelect($event)"
                    [database]="state.database" [entity]="entity"></orm-browser-database-browser>
                </ng-container> -->

                <ng-container *ngFor="let browser of browserStack">
                    <orm-browser-database-browser *ngIf="state.database && browser.foreignSchema"
                                                  [class.hidden]="browserStack.length > 0 && browser !== browserStack[browserStack.length - 1]"
                                                  [dialog]="true"
                                                  [withBack]="browser !== browserStack[0]"
                                                  (back)="popBrowser()"
                                                  [selectedPkHashes]="browser.selectedPkHashes"
                                                  [multiSelect]="browser.property.isArray"
                                                  (select)="browser.onSelect($event)"
                                                  [database]="state.database"
                                                  [entity]="browser.foreignSchema"></orm-browser-database-browser>
                </ng-container>
            </div>
        </dui-dialog>
    `,
    host: {
        '(click)': 'open = true',
        '[attr.tabIndex]': '1',
    },
    styles: [`
        .json-editor {
            height: 100%;
            padding: 0 12px;
            display: flex;
            flex-direction: column;
        }

        .json-editor dui-input {
            margin-top: 15px;
            width: 100%;
            flex: 1;
        }

        .layout {
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        ::ng-deep dui-window-content > div.class-field-dialog {
            padding: 0 !important;
            padding-top: 10px !important;
        }

        .header {
            flex: 0 0 18px;
            padding: 0 15px;
            padding-top: 4px;
        }

        orm-browser-database-browser {
            flex: 1;
        }

        .hidden {
            display: none;
        }
    `]
})
export class ClassInputComponent implements AfterViewInit, OnChanges, OnDestroy {
    @Input() model: any;
    @Output() modelChange = new EventEmitter();
    @Input() row: any;

    @Input() property!: PropertySchema;
    @Input() autoOpen: boolean = true;

    open = false;
    jsonEditor = false;
    jsonContent = '';

    selectedPkHashes: string[] = [];

    @Output() done = new EventEmitter<void>();
    @Output() keyDown = new EventEmitter<KeyboardEvent>();

    browserStack: ClassInputComponent[] = [];

    foreignSchema?: ClassSchema;

    getLastBrowser(): ClassInputComponent | undefined {
        if (!this.browserStack.length) return undefined;
        return this.browserStack[this.browserStack.length - 1];
    }

    constructor(
        protected duiDialog: DuiDialog,
        public host: ElementRef,
        public state: BrowserState,
        public cd: ChangeDetectorRef,
        @Optional() @SkipSelf() public parent: ClassInputComponent,
    ) {
        this.browserStack.push(this);
    }

    jsonDone() {
        try {
            const obj = JSON.parse(this.jsonContent);
            this.model = jsonSerializer.deserializeProperty(this.property, obj);
            this.modelChange.emit(this.model);

            this.jsonEditor = false;
            this.done.emit();
        } catch (error) {
            this.duiDialog.alert('Invalid JSON');
        }
    }

    popBrowser() {
        const last = this.browserStack[this.browserStack.length - 1];
        if (!last) return;

        last.closeAndDone();
    }

    closeAndDone() {
        this.done.emit();
    }

    registerBrowser(child: ClassInputComponent) {
        this.browserStack.push(child);
        this.browserStack = this.browserStack.slice();
        this.cd.detectChanges();
    }

    deregisterBrowser(child: ClassInputComponent) {
        arrayRemoveItem(this.browserStack, child);
        this.cd.detectChanges();
    }

    ngOnDestroy() {
        this.done.emit(); //make sure that the column is disabled editing when this is destroyed
        if (this.parent) this.parent.deregisterBrowser(this);
    }

    ngOnChanges() {
        this.load();
    }

    load() {
        this.foreignSchema = this.property.getResolvedClassSchema();
        if (this.property.isReference) {
            this.open = this.autoOpen;
            this.loadSelection();
        } else {
            this.jsonEditor = true;
            if (this.model !== undefined) {
                this.jsonContent = JSON.stringify(jsonSerializer.serializeProperty(this.property, this.model));
            } else {
                this.jsonContent = '';
            }
            this.cd.detectChanges();
        }
    }

    loadSelection() {
        if (!this.foreignSchema) return;
        this.selectedPkHashes = [];

        if (this.model !== undefined) {
            if (this.state.isIdWrapper(this.model)) {
                this.selectedPkHashes.push(this.state.extractHashFromIdWrapper(this.model));
            } else {
                this.selectedPkHashes.push(getPrimaryKeyHashGenerator(this.foreignSchema)(this.model));
            }
        }
    }

    onSelect(event: { items: any[], pkHashes: string[] }) {
        if (!this.foreignSchema) return;

        const selected = event.items[0];
        if (selected) {
            if (this.state.isNew(selected)) {
                this.state.connectNewItem(selected, this.row, this.property);
                this.model = this.state.getNewItemIdWrapper(selected);
            } else {
                this.model = this.foreignSchema.extractPrimaryKey(selected);
            }
        } else if (this.property.isOptional || this.property.isNullable) {
            this.model = this.property.isNullable ? null : undefined;
        }
        this.modelChange.emit(this.model);

        setTimeout(() => {
            this.popBrowser();
            ReactiveChangeDetectionModule.tick();
        }, 60);
    }

    ngAfterViewInit() {
        this.load();
        if (this.property.isReference) {
            this.foreignSchema = this.property.getResolvedClassSchema();
            this.loadSelection();
            if (this.parent) {
                this.parent.registerBrowser(this);
            } else {
                this.cd.detectChanges();
            }
        }
    }
}
