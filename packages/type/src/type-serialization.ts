import {
    isWithAnnotations,
    OuterType,
    ReflectionKind,
    ReflectionVisibility,
    Type,
    TypeAnnotations,
    TypeArray,
    TypeBaseMember,
    TypeClass,
    typeDecorators,
    TypeEnum,
    TypeFunction,
    TypeIndexSignature,
    TypeLiteral,
    TypeObjectLiteral,
    TypeParameter,
    TypeProperty,
    TypeRest,
    TypeRuntimeData,
    TypeTuple,
    TypeTupleMember
} from './reflection/type';
import { getClassName, getParentClass } from '@deepkit/core';
import { reflect, ReflectionClass } from './reflection/reflection';
import { typeSettings } from './core';
import { regExpFromString } from './utils';

export interface SerializedTypeAnnotations {
    typeName?: string;

    typeArguments?: SerializedTypeReference[];

    indexAccessOrigin?: { container: SerializedTypeReference, index: SerializedTypeReference };

    // annotations will be generated on deserialization from the decorators
    // annotations?: Annotations; //parsed decorator types as annotations

    decorators?: SerializedTypeReference[]; //original decorator type
}

interface SerializedTypeObjectLiteral extends SerializedTypeAnnotations {
    kind: ReflectionKind.objectLiteral,
    types: SerializedTypeReference[];
}

interface SerializedTypeClassType {
    kind: ReflectionKind.class,
    name?: string; //@entity.name
    globalObject?: true; //Uint8Array, Date, etc
    classType: string; //getClassName result
    extendsArguments?: SerializedTypeReference[];
    arguments?: SerializedTypeReference[];
    superClass?: SerializedTypeReference;
    types: SerializedTypeReference[];
}

interface SerializedTypeFunction extends SerializedTypeAnnotations {
    kind: ReflectionKind.function,
    name?: number | string | symbol,
    parameters: SerializedTypeParameter[];
    return: SerializedTypeReference;
}

type SerializedTypeReference = number;

interface SimpleSerializedType extends SerializedTypeAnnotations {
    kind: ReflectionKind.never | ReflectionKind.any | ReflectionKind.unknown | ReflectionKind.void | ReflectionKind.object | ReflectionKind.string
        | ReflectionKind.number | ReflectionKind.boolean | ReflectionKind.symbol | ReflectionKind.bigint | ReflectionKind.null | ReflectionKind.undefined | ReflectionKind.regexp;
    origin?: SerializedTypeReference;
}

interface SerializedTypeLiteral extends SerializedTypeAnnotations {
    kind: ReflectionKind.literal,
    literal: { type: 'symbol', name: string } | string | number | boolean | { type: 'bigint', value: string } | { type: 'regex', regex: string };
}

interface SerializedTypeTemplateLiteral extends SerializedTypeAnnotations {
    kind: ReflectionKind.templateLiteral,
    types: SerializedTypeReference[]
}

interface SerializedTypeParameter {
    kind: ReflectionKind.parameter,
    name: string;
    type: SerializedTypeReference;

    //parameter could be a property as well if visibility is set
    visibility?: ReflectionVisibility,
    readonly?: true;
    optional?: true,

    /**
     * Set when the parameter has a default value aka initializer.
     */
    default?: true
}

export interface SerializedTypeMethod extends TypeBaseMember {
    kind: ReflectionKind.method,
    visibility: ReflectionVisibility,
    name: number | string | symbol;
    parameters: SerializedTypeParameter[];
    optional?: true,
    abstract?: true;
    return: SerializedTypeReference;
}

interface SerializedTypeProperty extends TypeBaseMember, TypeRuntimeData {
    kind: ReflectionKind.property,
    visibility: ReflectionVisibility,
    name: number | string | symbol;
    optional?: true,
    readonly?: true;
    abstract?: true;
    description?: string;
    type: SerializedTypeReference;

    /**
     * Set when the property has a default value aka initializer.
     */
    default?: true
}

interface SerializedTypePromise extends SerializedTypeAnnotations {
    kind: ReflectionKind.promise,
    type: SerializedTypeReference;
}

interface SerializedTypeEnum extends SerializedTypeAnnotations {
    kind: ReflectionKind.enum,
    enum: { [name: string]: string | number | undefined | null };
    values: (string | number | undefined | null)[];
    indexType: SerializedTypeReference;
}

export interface SerializedTypeUnion {
    kind: ReflectionKind.union,
    types: SerializedTypeReference[];
}

export interface SerializedTypeIntersection {
    kind: ReflectionKind.intersection,
    types: SerializedTypeReference[];
}

interface SerializedTypeArray extends SerializedTypeAnnotations {
    kind: ReflectionKind.array,
    type: SerializedTypeReference;
}

interface SerializedTypeIndexSignature {
    kind: ReflectionKind.indexSignature,
    index: SerializedTypeReference;
    type: SerializedTypeReference;
}

interface SerializedTypePropertySignature {
    kind: ReflectionKind.propertySignature,
    name: number | string | symbol;
    optional?: true;
    readonly?: true;
    description?: string;
    type: SerializedTypeReference;
}

interface SerializedTypeMethodSignature {
    kind: ReflectionKind.methodSignature,
    name: number | string | symbol;
    optional?: true;
    parameters: SerializedTypeParameter[];
    return: SerializedTypeReference;
}

export interface SerializedTypeTypeParameter {
    kind: ReflectionKind.typeParameter,
    name: string,
}

interface SerializedTypeInfer {
    kind: ReflectionKind.infer,
}

interface SerializedTypeTupleMember {
    kind: ReflectionKind.tupleMember,
    type: SerializedTypeReference;
    optional?: true;
    name?: string;
}

interface SerializedTypeTuple extends TypeAnnotations, TypeRuntimeData {
    kind: ReflectionKind.tuple,
    types: SerializedTypeTupleMember[]
}

interface SerializedTypeRest {
    kind: ReflectionKind.rest,
    type: SerializedTypeReference,
}

export type SerializedType =
    SimpleSerializedType
    | SerializedTypeLiteral
    | SerializedTypeTemplateLiteral
    | SerializedTypeParameter
    | SerializedTypeFunction
    | SerializedTypeMethod
    | SerializedTypeProperty
    | SerializedTypePromise
    | SerializedTypeClassType
    | SerializedTypeEnum
    | SerializedTypeUnion
    | SerializedTypeIntersection
    | SerializedTypeArray
    | SerializedTypeObjectLiteral
    | SerializedTypeIndexSignature
    | SerializedTypePropertySignature
    | SerializedTypeMethodSignature
    | SerializedTypeTypeParameter
    | SerializedTypeInfer
    | SerializedTypeTuple
    | SerializedTypeTupleMember
    | SerializedTypeRest;

export type SerializedTypes = SerializedType[];

function isWithSerializedAnnotations(type: any): type is SerializedTypeAnnotations {
    return isWithAnnotations(type);
}

export interface SerializerState {
    types: SerializedTypes;
    disableMethods?: true;
    refs: Map<Type, number>;
}

function filterRemoveFunctions(v: Type): boolean {
    return v.kind !== ReflectionKind.function && v.kind !== ReflectionKind.method && v.kind !== ReflectionKind.methodSignature;
}

function serialize(type: Type, state: SerializerState): SerializedTypeReference {
    const serialized = state.refs.get(type);
    if (serialized) return serialized;

    const result: SerializedType = { kind: type.kind } as SerializedType;

    state.types.push(result);
    const index = state.types.length - 1;
    state.refs.set(type, index);

    if (isWithAnnotations(type)) {
        if (type.typeName) (result as SerializedTypeAnnotations).typeName = type.typeName;
        if (type.decorators) (result as SerializedTypeAnnotations).decorators = type.decorators.map(v => serialize(v, state));
        if (type.typeArguments) (result as SerializedTypeAnnotations).typeArguments = type.typeArguments.map(v => serialize(v, state));
        if (type.indexAccessOrigin) (result as SerializedTypeAnnotations).indexAccessOrigin = {
            index: serialize(type.indexAccessOrigin.index, state),
            container: serialize(type.indexAccessOrigin.container, state)
        };
    }

    switch (type.kind) {
        case ReflectionKind.objectLiteral: {
            const types = state.disableMethods ? type.types.filter(filterRemoveFunctions) : type.types;
            Object.assign(result, {
                kind: ReflectionKind.objectLiteral,
                types: types.map(member => serialize(member, state)),
            } as SerializedTypeObjectLiteral);
            break;
        }
        case ReflectionKind.class: {
            const types = state.disableMethods ? type.types.filter(filterRemoveFunctions) : type.types;
            const parent = getParentClass(type.classType);
            let superClass: SerializedTypeReference | undefined = undefined;
            try {
                superClass = parent ? serialize(reflect(parent), state) : undefined;
            } catch {
            }

            const classType = getClassName(type.classType);
            const globalObject: boolean = global && (global as any)[classType] === type.classType;

            Object.assign(result, {
                kind: ReflectionKind.class,
                types: types.map(member => serialize(member, state)),
                name: ReflectionClass.from(type.classType).name,
                globalObject: globalObject ? true : undefined,
                classType,
                arguments: type.arguments ? type.arguments.map(member => serialize(member, state)) : undefined,
                extendsArguments: type.extendsArguments ? type.extendsArguments.map(member => serialize(member, state)) : undefined,
                superClass,
            } as SerializedTypeClassType);
            break;
        }
        case ReflectionKind.literal: {
            Object.assign(result, {
                kind: ReflectionKind.literal,
                literal: 'symbol' === typeof type.literal ? { type: 'symbol', name: type.literal.toString().slice(7, -1) } :
                    'bigint' === typeof type.literal ? { type: 'bigint', value: String(type.literal) } :
                        type.literal instanceof RegExp ? { type: 'regex', regex: String(type.literal) } :
                            type.literal
            } as SerializedTypeLiteral);
            break;
        }
        case ReflectionKind.tuple: {
            Object.assign(result, {
                kind: ReflectionKind.tuple,
                types: type.types.map(member => ({ ...member, parent: undefined, type: serialize(member.type, state) })),

            } as SerializedTypeTuple);
            break;
        }
        case ReflectionKind.union: {
            const types = state.disableMethods ? type.types.filter(filterRemoveFunctions) : type.types;
            Object.assign(result, {
                kind: ReflectionKind.union,
                types: types.map(member => serialize(member, state)),

            } as SerializedTypeUnion);
            break;
        }
        case ReflectionKind.intersection: {
            Object.assign(result, {
                kind: ReflectionKind.intersection,
                types: type.types.map(member => serialize(member, state)),

            } as SerializedTypeIntersection);
            break;
        }
        case ReflectionKind.templateLiteral: {
            Object.assign(result, {
                kind: ReflectionKind.templateLiteral,
                types: type.types.map(member => serialize(member, state)),

            } as SerializedTypeTemplateLiteral);
            break;
        }
        case ReflectionKind.string:
        case ReflectionKind.number:
        case ReflectionKind.boolean:
        case ReflectionKind.symbol:
        case ReflectionKind.bigint:
        case ReflectionKind.regexp: {
            if (type.origin) (result as SimpleSerializedType).origin = serialize(type.origin, state);
            break;
        }
        case ReflectionKind.function: {
            if (state.disableMethods) {
                result.kind = ReflectionKind.never;
                break;
            }
            Object.assign(result, {
                kind: ReflectionKind.function,
                parameters: type.parameters.map(v => ({ ...v, parent: undefined, type: serialize(v.type, state), default: v.default !== undefined ? true : undefined })),
                return: serialize(type.return, state)
            } as SerializedTypeFunction);
            break;
        }
        case ReflectionKind.method: {
            if (state.disableMethods) {
                result.kind = ReflectionKind.never;
                break;
            }
            Object.assign(result, {
                ...type,
                parent: undefined,
                parameters: type.parameters.map(v => ({
                    ...v,
                    parent: undefined,
                    type: serialize(v.type, state),
                    default: v.default !== undefined ? true : undefined
                } as SerializedTypeParameter)),
                return: serialize(type.return, state)
            } as SerializedTypeMethod);
            break;
        }
        case ReflectionKind.methodSignature: {
            if (state.disableMethods) {
                result.kind = ReflectionKind.never;
                break;
            }
            Object.assign(result, {
                ...type,
                parent: undefined,
                parameters: type.parameters.map(v => ({
                    ...v,
                    parent: undefined,
                    type: serialize(v.type, state),
                    default: v.default !== undefined ? true : undefined
                } as SerializedTypeParameter)),
                return: serialize(type.return, state)
            } as SerializedTypeMethodSignature);
            break;
        }
        case ReflectionKind.propertySignature: {
            Object.assign(result, {
                ...type,
                parent: undefined,
                type: serialize(type.type, state),
            } as SerializedTypePropertySignature);
            break;
        }
        case ReflectionKind.property: {
            Object.assign(result, {
                ...type,
                parent: undefined,
                default: type.default !== undefined ? true : undefined,
                type: serialize(type.type, state),
            } as SerializedTypeProperty);
            break;
        }
        case ReflectionKind.array: {
            Object.assign(result, {
                kind: ReflectionKind.array,
                type: serialize(type.type, state),
            } as SerializedTypeArray);
            break;
        }
        case ReflectionKind.promise: {
            Object.assign(result, {
                kind: ReflectionKind.promise,
                type: serialize(type.type, state),
            } as SerializedTypePromise);
            break;
        }
        case ReflectionKind.rest: {
            Object.assign(result, {
                kind: ReflectionKind.rest,
                type: serialize(type.type, state),
            } as SerializedTypeRest);
            break;
        }
        case ReflectionKind.indexSignature: {
            Object.assign(result, {
                kind: ReflectionKind.indexSignature,
                index: serialize(type.index, state),
                type: serialize(type.type, state),
            } as SerializedTypeIndexSignature);
            break;
        }
        case ReflectionKind.enum: {
            Object.assign(result, {
                kind: ReflectionKind.enum,
                enum: type.enum,
                values: type.values,
                indexType: serialize(type.indexType, state),
            } as SerializedTypeEnum);
            break;
        }
    }

    return index;
}

/**
 * Converts a (possibly circular/nested) type into a JSON.stringify'able structure suited to be transmitted over the wire and deserialized back to the correct Type object.
 */
export function serializeType(type: Type, state: Partial<SerializerState> = {}): SerializedTypes {
    const types: SerializedTypes = [];
    const serializedState: SerializerState = { types, refs: new Map, ...state };
    serialize(type, serializedState);
    return types;
}

interface DeserializeState {
    types: SerializedTypes;
    disableReuse?: boolean, //disable entity reuse from entities registered via @entity.name()
    deserialized: { [index: number]: { type: Type, refs: Type[], active: boolean } };
}

/**
 * @reflection never
 */
function deserialize(type: SerializedType | SerializedTypeReference, state: DeserializeState, parent?: Type): Type {
    if ('number' === typeof type) {
        if (!state.types[type]) return { kind: ReflectionKind.unknown };
        const typeState = state.deserialized[type];
        let result: Type = { kind: ReflectionKind.unknown };

        if (typeState) {
            if (typeState.active) {
                typeState.refs.push(result);
            } else {
                result = typeState.type;
            }
        } else {
            const typeState = { type: result as Type, refs: [], active: true };
            state.deserialized[type] = typeState;
            typeState.type = deserialize(state.types[type], state);
            typeState.active = false;
            for (const ref of typeState.refs) Object.assign(ref, typeState.type);
            result = typeState.type;
        }
        if (parent) return Object.assign(result, { parent });

        return result;
    }
    const result: Type = { kind: type.kind } as Type;

    if (isWithSerializedAnnotations(type) && isWithAnnotations(result)) {
        if (type.typeName) result.typeName = type.typeName;
        if (type.typeArguments) result.typeArguments = type.typeArguments.map(v => deserialize(v, state)) as OuterType[];
        if (type.indexAccessOrigin) result.indexAccessOrigin = {
            index: deserialize(type.indexAccessOrigin.index, state) as OuterType,
            container: deserialize(type.indexAccessOrigin.container, state) as TypeClass | TypeObjectLiteral
        };
    }

    switch (type.kind) {
        case ReflectionKind.objectLiteral: {
            Object.assign(result, {
                kind: ReflectionKind.objectLiteral,
                types: type.types.map(v => deserialize(v, state, result))
            } as TypeObjectLiteral);
            break;
        }
        case ReflectionKind.class: {
            if (!state.disableReuse && type.name) {
                const existing = typeSettings.registeredEntities[type.name];
                if (existing) {
                    Object.assign(result, ReflectionClass.from(existing).type);
                    break;
                }
            }

            const newClass = !type.globalObject && state.disableReuse === true || (!type.name || !typeSettings.registeredEntities[type.name]);

            const classType = type.globalObject ? (global as any)[type.classType] : newClass
                ? (type.superClass ? class extends (deserialize(type.superClass, state) as TypeClass).classType {
                } : class {
                }) : typeSettings.registeredEntities[type.name!];

            if (newClass) {
                Object.defineProperty(classType, 'name', { value: type.classType, writable: true, enumerable: false });
            }
            Object.assign(result, {
                kind: ReflectionKind.class,
                classType,
                arguments: type.arguments ? type.arguments.map(v => deserialize(v, state, result)) : undefined,
                extendsArguments: type.extendsArguments ? type.extendsArguments.map(v => deserialize(v, state, result)) : undefined,
                types: type.types.map(v => deserialize(v, state, result)),
            } as TypeClass);
            break;
        }
        case ReflectionKind.literal: {
            Object.assign(result, {
                kind: ReflectionKind.literal,
                literal: 'string' === typeof type.literal ? type.literal : 'number' === typeof type.literal ? type.literal : 'boolean' === typeof type.literal ? type.literal :
                    'symbol' === type.literal.type ? Symbol(type.literal.name) : 'bigint' === type.literal.type ? BigInt(type.literal.value) : 'regex' === type.literal.type ? regExpFromString(type.literal.regex) : false
            } as TypeLiteral);
            break;
        }
        case ReflectionKind.tuple: {
            Object.assign(result, {
                kind: ReflectionKind.tuple,
                types: []
            } as TypeTuple);
            for (const member of type.types) {
                const deserializedMember: TypeTupleMember = { ...member, parent: result as TypeTuple, type: { kind: ReflectionKind.unknown } };
                deserializedMember.type = deserialize(member.type, state, deserializedMember);
                (result as TypeTuple).types.push(deserializedMember);
            }
            break;
        }
        case ReflectionKind.templateLiteral:
        case ReflectionKind.intersection:
        case ReflectionKind.union: {
            Object.assign(result, {
                kind: type.kind,
                types: type.types.map(member => deserialize(member, state, result))
            });
            break;
        }
        case ReflectionKind.string:
        case ReflectionKind.number:
        case ReflectionKind.bigint:
        case ReflectionKind.symbol:
        case ReflectionKind.regexp:
        case ReflectionKind.boolean: {
            result.kind = type.kind;
            if (type.origin) {
                Object.assign(result, {
                    origin: deserialize(type.origin, state, result)
                });
            }
            break;
        }
        case ReflectionKind.any:
        case ReflectionKind.unknown:
        case ReflectionKind.void:
        case ReflectionKind.undefined:
        case ReflectionKind.null: {
            //nothing to do
            break;
        }
        case ReflectionKind.methodSignature:
        case ReflectionKind.method:
        case ReflectionKind.function: {
            const parameters: TypeParameter[] = [];
            for (const p of type.parameters) {
                const parameter: TypeParameter = { ...p, parent: result as TypeFunction, default: p.default ? () => undefined : undefined, type: { kind: ReflectionKind.unknown } };
                parameter.type = deserialize(p.type, state, parameter) as OuterType;
                parameters.push(parameter);
            }
            Object.assign(result, {
                name: type.name,
                parameters,
                return: deserialize(type.return, state, result)
            } as TypeFunction);
            break;
        }
        case ReflectionKind.property:
        case ReflectionKind.propertySignature: {
            Object.assign(result, {
                ...type,
                default: type.kind === ReflectionKind.property ? type.default ? () => undefined : undefined : undefined,
                type: deserialize(type.type, state, result),
            } as TypeProperty);
            break;
        }
        case ReflectionKind.array:
        case ReflectionKind.promise:
        case ReflectionKind.rest: {
            Object.assign(result, {
                type: deserialize(type.type, state, result)
            } as TypeArray | TypeProperty | TypeRest);
            break;
        }
        case ReflectionKind.indexSignature: {
            Object.assign(result, {
                index: deserialize(type.index, state, result),
                type: deserialize(type.type, state, result)
            } as TypeIndexSignature);
            if ((result as TypeIndexSignature).index.parent !== result) throw new Error('wat');
            break;
        }
        case ReflectionKind.enum: {
            Object.assign(result, {
                enum: type.enum,
                values: type.values,
                indexType: deserialize(type.indexType, state, result),
            } as TypeEnum);
            break;
        }
    }

    if (isWithSerializedAnnotations(type) && isWithAnnotations(result) && type.decorators) {
        result.annotations = {};
        for (const scheduledDecorator of type.decorators) {
            for (const decorator of typeDecorators) {
                const dec = deserialize(scheduledDecorator, state) as TypeObjectLiteral;
                decorator(result.annotations, dec);
            }
        }
    }
    return result;
}

export function deserializeType(types: SerializedTypes, state: Partial<DeserializeState> = {}): Type {
    return deserialize(types[0], { ...state, deserialized: {}, types });
}
