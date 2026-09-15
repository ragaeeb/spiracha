export type Capability<Value> =
    | { state: 'supported'; value: Value }
    | { reason: string; state: 'unsupported' }
    | { reason: string; state: 'not_applicable' };

// Only a literal supported declaration requires a callable handler.
export type CapabilityBinding<Declaration extends Capability<unknown>, Handler> = Declaration extends {
    state: 'supported';
}
    ? { handler: Handler }
    : { handler?: never };
