/* Copyright (C) 2026 NooBaa */

// Ambient declarations for the "JSON source text access" proposal, which
// src/sdk/s3_tables/lossless_json.js depends on to keep out-of-range Iceberg snapshot
// ids byte-identical (design §8.1). Node 21+ ships it - NooBaa pins 24.13 in .nvmrc -
// but the TypeScript version in devDependencies ships no lib declaration for it, and
// tsconfig.json runs checkJs over all of src. Declaring it here rather than bumping
// `lib` repo-wide keeps the surface to this one directory.
//
// Remove this file once the installed TypeScript declares JSON.rawJSON.

interface RawJSON {
    readonly rawJSON: string;
}

interface JSON {

    /** Wrap valid JSON source text so JSON.stringify emits it unchanged. */
    rawJSON(text: string): RawJSON;

    /** Whether a value was produced by JSON.rawJSON or by a reviver returning one. */
    isRawJSON(value: unknown): value is RawJSON;

    /** The three-argument reviver form, whose context carries the raw source text. */
    parse(
        text: string,
        reviver: (this: any, key: string, value: any, context?: { source?: string }) => any,
    ): any;

}
