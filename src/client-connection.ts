import {Injectable, Injector, Inject} from "injection-js";
import {Observable, Subscription} from "rxjs";
import {Application, SessionStack} from "./application";
import {ActionTypes, ClientMessageAll, executeActionAndSerialize, getActionParameters, getActionReturnType, getActions} from "@marcj/glut-core";
import {ConnectionMiddleware} from "./connection-middleware";
import {ConnectionWriter} from "./connection-writer";
import {arrayRemoveItem, each, sleep} from "@marcj/estdlib";
import {uuid} from "@marcj/marshal";
import {Exchange} from "./exchange";
import {AsyncSubscription, Subscriptions} from "@marcj/estdlib-rxjs";
import {Locker} from "./locker";


@Injectable()
export class ClientConnection {
    protected timeoutTimers: any[] = [];
    protected destroyed = false;
    protected usedControllers: { [path: string]: any } = {};

    private cachedActionsTypes: {
        [controllerName: string]: { [actionName: string]: ActionTypes }
    } = {};

    private registeredPeerControllers: { [name: string]: { sub: Subscription, lock: AsyncSubscription } } = {};

    protected pushMessageReplyId = 0;
    protected pushMessageReplies: { [id: string]: (data: any) => void } = {};

    protected unsubscribeOnDisconnectSubscriptions = new Subscriptions();

    constructor(
        protected app: Application,
        protected sessionStack: SessionStack,
        protected injector: Injector,
        protected locker: Locker,
        protected exchange: Exchange,
        protected connectionMiddleware: ConnectionMiddleware,
        protected writer: ConnectionWriter,
        @Inject('remoteAddress') public readonly remoteAddress: string,
    ) {
    }

    /**
     * Is called when connection breaks or client disconnects.
     */
    public destroy() {
        this.connectionMiddleware.destroy();
        this.destroyed = true;

        for (const timeout of this.timeoutTimers) {
            clearTimeout(timeout);
        }

        this.unsubscribeOnDisconnectSubscriptions.unsubscribe();

        for (const usedController of each(this.usedControllers)) {
            if (usedController.destroy) {
                usedController.destroy();
            }
        }

        for (const peer of each(this.registeredPeerControllers)) {
            peer.sub.unsubscribe();
            peer.lock.unsubscribe();
        }
    }

    public isActive(): boolean {
        return !this.destroyed;
    }

    public isLocal(): boolean {
        return this.remoteAddress === '127.0.0.1'
            || this.remoteAddress === '::1';
    }

    /**
     * Creates a regular timer using setTimeout() and automatically cancel it once the connection breaks or server stops.
     */
    public setTimeout(cb: () => void, timeout: number): any {
        const timer = setTimeout(() => {
            cb();
            arrayRemoveItem(this.timeoutTimers, timer);
        }, timeout);
        this.timeoutTimers.push(timer);
        return timer;
    }

    public async sendPushMessage(data: any): Promise<any> {
        const replyId = ++this.pushMessageReplyId;

        return new Promise<any>((resolve, reject) => {
            this.pushMessageReplies[replyId] = (data: any) => {
                resolve(data);
                delete this.pushMessageReplies[replyId];
            };

            this.writer.write({
                type: 'push-message',
                replyId: replyId,
                next: data
            });
        });
    }

    public async onMessage(raw: string) {
        if ('string' === typeof raw) {
            const message = JSON.parse(raw) as ClientMessageAll;
            // console.log('server onMessage', message);

            if (message.name === 'push-message/reply') {
                if (!this.pushMessageReplies[message.replyId]) {
                    throw new Error(`No reply callback for push-message ${message.replyId}`);
                }

                this.pushMessageReplies[message.replyId](message.data);
            }

            if (message.name === 'peerController/unregister') {
                if (!this.registeredPeerControllers[message.controllerName]) {
                    this.writer.sendError(message.id, `Controller with name ${message.controllerName} not registered.`);
                    return;
                }

                this.registeredPeerControllers[message.controllerName].sub.unsubscribe();
                await this.registeredPeerControllers[message.controllerName].lock.unsubscribe();
                delete this.registeredPeerControllers[message.controllerName];
            }

            if (message.name === 'peerController/message') {
                this.exchange.publish('peerController/' + message.controllerName + '/reply/' + message.replyId, message.data);
                return;
            }

            if (message.name === 'peerController/register') {
                const access = await this.app.isAllowedToRegisterPeerController(this.injector, this.sessionStack.getSessionOrUndefined(), message.controllerName);

                if (!access) {
                    this.writer.sendError(message.id, 'Access denied to register controller ' + message.controllerName);
                    return;
                }

                try {
                    if (this.registeredPeerControllers[message.controllerName]) {
                        this.writer.sendError(message.id, `Controller with name ${message.controllerName} already registered.`);
                        return;
                    }

                    //check if registered
                    const locked = await this.locker.isLocked('peerController/' + message.controllerName);
                    if (locked) {
                        this.writer.sendError(message.id, `Controller with name ${message.controllerName} already registered.`);
                        return;
                    }

                    const lock = await this.locker.acquireLockWithAutoExtending('peerController/' + message.controllerName, 10);

                    const sub = await this.exchange.subscribe('peerController/' + message.controllerName, (controllerMessage: { replyId: string, data: any }) => {
                        this.writer.write({
                            id: message.id,
                            type: 'peerController/message',
                            replyId: controllerMessage.replyId,
                            data: controllerMessage.data
                        });
                    });

                    this.registeredPeerControllers[message.controllerName] = {
                        sub: sub,
                        lock: lock,
                    };

                    this.writer.ack(message.id);
                } catch (error) {
                    this.writer.sendError(message.id, `Controller with name ${message.controllerName} already registered. ` + error);
                }
                return;
            }

            if (message.name === 'action') {
                try {
                    if (message.controller.startsWith('_peer/')) {
                        const controllerName = message.controller.substr('_peer/'.length);

                        const access = await this.app.isAllowedToSendToPeerController(this.injector, this.sessionStack.getSessionOrUndefined(), controllerName);

                        if (!access) {
                            this.writer.sendError(message.id, `Access denied to peer controller ` + controllerName, 'access_denied');
                            return;
                        }

                        //check if registered
                        const locked = await this.locker.isLocked('peerController/' + controllerName);

                        if (!locked) {
                            this.writer.sendError(message.id, `Peer controller ${controllerName} not registered`, 'peer_not_registered');
                            return;
                        }

                        const replyId = uuid();
                        const sub = await this.exchange.subscribe('peerController/' + controllerName + '/reply/' + replyId, (reply: any) => {
                            this.writer.write({...reply, id: message.id});
                            sub.unsubscribe();
                        });

                        this.unsubscribeOnDisconnectSubscriptions.add = sub;

                        setTimeout(() => {
                            if (!sub.closed) {
                                sub.unsubscribe();
                                this.writer.sendError(message.id, `Peer timed out ` + controllerName, 'peer_timeout');
                            }
                        }, message.timeout * 1000);

                        this.exchange.publish('peerController/' + controllerName, {
                            replyId: replyId,
                            data: {
                                ...message,
                                controller: controllerName
                            }
                        });
                    } else {
                        await this.actionSend(message, () => this.action(message.controller, message.action, message.args));
                    }
                } catch (error) {
                    console.error(`Error in ${message.controller}.${message.action}`, error);
                }
                return;
            }

            if (message.name === 'actionTypes') {
                try {
                    if (message.controller.startsWith('_peer/')) {
                        const controllerName = message.controller.substr('_peer/'.length);

                        //todo, check access
                        const access = await this.app.isAllowedToSendToPeerController(this.injector, this.sessionStack.getSessionOrUndefined(), controllerName);

                        if (!access) {
                            this.writer.sendError(message.id, `Access denied to peer controller ` + controllerName, 'access_denied');
                            return;
                        }

                        //check if registered
                        const locked = await this.locker.isLocked('peerController/' + controllerName);

                        if (!locked) {
                            this.writer.sendError(message.id, `Peer controller ${controllerName} not registered`, 'peer_not_registered');
                            return;
                        }

                        const replyId = uuid();
                        const sub = await this.exchange.subscribe('peerController/' + controllerName + '/reply/' + replyId, (reply: any) => {
                            this.writer.write({...reply, id: message.id});
                            sub.unsubscribe();
                        });

                        setTimeout(() => {
                            if (!sub.closed) {
                                sub.unsubscribe();
                                this.writer.sendError(message.id, `Peer timed out ` + controllerName, 'peer_timeout');
                            }
                        }, message.timeout * 1000);

                        this.unsubscribeOnDisconnectSubscriptions.add = sub;

                        this.exchange.publish('peerController/' + controllerName, {
                            replyId: replyId,
                            data: {
                                ...message,
                                controller: controllerName
                            }
                        });
                    } else {
                        const {parameters, returnType} = await this.getActionTypes(message.controller, message.action);

                        this.writer.write({
                            type: 'actionTypes/result',
                            id: message.id,
                            returnType: returnType,
                            parameters: parameters,
                        });
                    }
                } catch (error) {
                    this.writer.sendError(message.id, error);
                }
                return;
            }

            if (message.name === 'authenticate') {
                this.sessionStack.setSession(await this.app.authenticate(this.injector, message.token));

                this.writer.write({
                    type: 'authenticate/result',
                    id: message.id,
                    result: this.sessionStack.isSet(),
                });
                return;
            }

            await this.connectionMiddleware.messageIn(message);
        }
    }

    public async getActionTypes(controller: string, action: string)
        : Promise<ActionTypes> {

        if (!this.cachedActionsTypes[controller]) {
            this.cachedActionsTypes[controller] = {};
        }

        if (!this.cachedActionsTypes[controller][action]) {

            const controllerClass = await this.app.resolveController(controller);

            if (!controllerClass) {
                throw new Error(`Controller not found for ${controller}`);
            }

            const access = await this.app.hasAccess(this.injector, this.sessionStack.getSessionOrUndefined(), controllerClass, action);
            if (!access) {
                throw new Error(`Access denied to action ` + action);
            }

            const actions = getActions(controllerClass);

            if (!actions[action]) {
                console.log('Action unknown, but method exists.', action);
                throw new Error(`Action unknown ${action}`);
            }

            this.cachedActionsTypes[controller][action] = {
                parameters: getActionParameters(controllerClass, action),
                returnType: getActionReturnType(controllerClass, action)
            };
        }

        return this.cachedActionsTypes[controller][action];
    }

    public async action(controller: string, action: string, args: any[]): Promise<any> {
        const controllerClass = await this.app.resolveController(controller);

        if (!controllerClass) {
            throw new Error(`Controller not found for ${controller}`);
        }

        const access = await this.app.hasAccess(this.injector, this.sessionStack.getSessionOrUndefined(), controllerClass, action);
        if (!access) {
            throw new Error(`Access denied to action ` + action);
        }

        const controllerInstance = this.injector.get(controllerClass);

        this.usedControllers[controller] = controllerInstance;

        const methodName = action;
        const fullName = `${controller}::${action}`;

        if ((controllerInstance as any)[methodName]) {
            const actions = getActions(controllerClass);

            if (!actions[methodName]) {
                console.log('Action unknown, but method exists.', fullName);
                throw new Error(`Action unknown ${fullName}`);
            }

            const types = await this.getActionTypes(controller, action);

            return executeActionAndSerialize(types, controllerInstance, methodName, args);
        }

        throw new Error(`Action unknown ${fullName}`);
    }

    public async actionSend(message: ClientMessageAll, exec: (() => Promise<any> | Observable<any>)) {
        try {
            await this.connectionMiddleware.actionMessageOut(message, await exec());
        } catch (error) {
            await this.writer.sendError(message.id, error);
            throw error;
        }
    }
}
