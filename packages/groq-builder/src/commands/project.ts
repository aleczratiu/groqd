import { ExtractTypeMismatchErrors, notNull, Simplify } from "../types/utils";
import { GroqBuilder } from "../groq-builder";
import { Parser, ParserFunction } from "../types/public-types";
import { isParser, normalizeValidationFunction } from "./validate-utils";
import { ResultItem } from "../types/result-types";
import {
  ExtractProjectionResult,
  ProjectionFieldConfig,
  ProjectionMap,
} from "./projection-types";
import { isConditional } from "./conditional-types";
import {
  simpleArrayParser,
  simpleObjectParser,
} from "../validation/simple-validation";

declare module "../groq-builder" {
  export interface GroqBuilder<TResult, TQueryConfig> {
    /**
     * Performs an "object projection", returning an object with the fields specified.
     *
     * @param projectionMap - The projection map is an object, mapping field names to projection values.
     * @param ProjectionMapTypeMismatchErrors - This is only used for reporting errors from the projection.
     */
    project<
      TProjection extends ProjectionMap<ResultItem.Infer<TResult>>,
      _TProjectionResult = ExtractProjectionResult<
        ResultItem.Infer<TResult>,
        TProjection
      >
    >(
      projectionMap:
        | TProjection
        | ((
            q: GroqBuilder<ResultItem.Infer<TResult>, TQueryConfig>
          ) => TProjection),
      ...ProjectionMapTypeMismatchErrors: RequireAFakeParameterIfThereAreTypeMismatchErrors<_TProjectionResult>
    ): GroqBuilder<
      ResultItem.Override<TResult, Simplify<_TProjectionResult>>,
      TQueryConfig
    >;
  }
}

/**
 * When we map projection results, we return TypeMismatchError's
 * for any fields that have an invalid mapping configuration.
 * However, this does not cause TypeScript to throw any errors.
 *
 * In order to get TypeScript to complain about these invalid mappings,
 * we will "require" an extra parameter, which will reveal the error messages.
 */
type RequireAFakeParameterIfThereAreTypeMismatchErrors<
  TProjectionResult,
  _Errors extends never | string = ExtractTypeMismatchErrors<TProjectionResult>
> = _Errors extends never
  ? [] // No errors, yay! Do not require any extra parameters.
  : // We've got errors; let's require an extra parameter, with the error message:
    | [_Errors]
      // And this extra error message causes TypeScript to always log the entire list of errors:
      | ["⛔️ Error: this projection has type mismatches: ⛔️"];

GroqBuilder.implement({
  project(
    this: GroqBuilder,
    projectionMapArg: object | ((q: any) => object),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...ProjectionMapTypeMismatchErrors
  ): GroqBuilder<any> {
    // Retrieve the projectionMap:
    let projectionMap: object;
    if (typeof projectionMapArg === "function") {
      projectionMap = projectionMapArg(this.root);
    } else {
      projectionMap = projectionMapArg;
    }

    const keys = Object.keys(projectionMap) as Array<string>;

    // Compile query from projection values:
    const fields = keys
      .map((key) => {
        const fieldConfig = projectionMap[key as keyof typeof projectionMap];
        return normalizeProjectionField(key, fieldConfig);
      })
      .filter(notNull);

    if (this.internal.options.validationRequired) {
      // Validate that we have provided validation functions for all fields:
      const invalidFields = fields.filter((f) => !f.parser);
      if (invalidFields.length) {
        throw new TypeError(
          "[groq-builder] Because 'validationRequired' is enabled, " +
            "every field must have validation (like `q.string()`), " +
            "but the following fields are missing it: " +
            `${invalidFields.map((f) => `"${f.key}"`)}`
        );
      }
    }

    const queries = fields.map((v) => v.query);
    const { newLine, space } = this.indentation;
    const newQuery = ` {${newLine}${space}${queries.join(
      `,${newLine}${space}`
    )}${newLine}}`;

    // Create a combined parser:
    const projectionParser = createProjectionParser(fields);

    return this.chain(newQuery, projectionParser);
  },
});

function normalizeProjectionField(
  key: string,
  fieldConfig: ProjectionFieldConfig<any, any>
): null | NormalizedProjectionField {
  // Analyze the field configuration:
  const value: unknown = fieldConfig;
  if (value instanceof GroqBuilder) {
    const query = isConditional(key) // Conditionals can ignore the key
      ? value.query
      : key === value.query // Use shorthand syntax
      ? key
      : `"${key}": ${value.query}`;
    return { key, query, parser: value.parser };
  } else if (typeof value === "string") {
    const query = key === value ? key : `"${key}": ${value}`;
    return { key, query, parser: null };
  } else if (typeof value === "boolean") {
    if (value === false) return null; // 'false' will be excluded from the results
    return { key, query: key, parser: null };
  } else if (Array.isArray(value)) {
    const [projectionKey, parser] = value as [string, Parser];
    const query = key === projectionKey ? key : `"${key}": ${projectionKey}`;

    return {
      key,
      query,
      parser: normalizeValidationFunction(parser),
    };
  } else if (isParser(value)) {
    return {
      key,
      query: key,
      parser: normalizeValidationFunction(value),
    };
  } else {
    throw new Error(
      `Unexpected value for projection key "${key}": "${typeof value}"`
    );
  }
}

type UnknownObject = Record<string, unknown>;

type NormalizedProjectionField = {
  key: string;
  query: string;
  parser: ParserFunction | null;
};

function createProjectionParser(
  fields: NormalizedProjectionField[]
): ParserFunction | null {
  if (!fields.some((f) => f.parser)) {
    // No nested parsers!
    return null;
  }

  // Parse all normal fields:
  const normalFields = fields.filter((f) => !isConditional(f.key));
  const objectShape = Object.fromEntries(
    normalFields.map((f) => [f.key, f.parser])
  );
  const objectParser = simpleObjectParser(objectShape);

  // Parse all conditional fields:
  const conditionalFields = fields.filter((f) => isConditional(f.key));
  const conditionalParsers = conditionalFields
    .map((f) => f.parser)
    .filter(notNull);

  // Combine normal and conditional parsers:
  const combinedParsers = [objectParser, ...conditionalParsers];
  const combinedParser = (input: Record<string, unknown>) => {
    const result = {};
    for (const p of combinedParsers) {
      const parsed = p(input);
      Object.assign(result, parsed);
    }
    return result;
  };

  // Finally, transparently handle arrays or objects:
  const arrayParser = simpleArrayParser(combinedParser);
  return function projectionParser(
    input: UnknownObject | Array<UnknownObject>
  ) {
    // Operates against either an array or a single item:
    if (!Array.isArray(input)) {
      return combinedParser(input);
    }

    return arrayParser(input);
  };
}
