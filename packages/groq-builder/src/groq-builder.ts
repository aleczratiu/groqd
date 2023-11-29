import type { ParserFunction } from "./types/public-types";
import type { RootConfig } from "./types/schema-types";
import { chainParsers } from "./commands/parseUtils";

export type GroqBuilderOptions = {
  indent: string;
};

export class GroqBuilder<
  TResult = unknown,
  TRootConfig extends RootConfig = RootConfig
> {
  /**
   * Extends the GroqBuilder class by implementing methods.
   * This allows for this class to be split across multiple files in the `./commands/` folder.
   * @internal
   */
  static implement(methods: Partial<GroqBuilder>) {
    Object.assign(GroqBuilder.prototype, methods);
  }

  static implementProperties(properties: {
    [P in keyof GroqBuilder]?: PropertyDescriptor;
  }) {
    Object.defineProperties(
      GroqBuilder.prototype,
      properties as PropertyDescriptorMap
    );
  }

  constructor(
    protected readonly internal: {
      readonly query: string;
      readonly parser: null | ParserFunction<unknown, TResult>;
      readonly options: GroqBuilderOptions;
    }
  ) {}

  public get query() {
    return this.internal.query;
  }
  public get parser() {
    return this.internal.parser;
  }

  /**
   * Chains a new query to the existing one.
   */
  protected chain<TResultNew = TResult>(
    query: string,
    parser: ParserFunction | null = null
  ): GroqBuilder<TResultNew, TRootConfig> {
    return new GroqBuilder({
      query: this.internal.query + query,
      parser: chainParsers(this.internal.parser, parser),
      options: this.internal.options,
    });
  }

  /**
   * Untyped "escape hatch" allowing you to write any query you want
   */
  public any<TResultNew = TResult>(
    query: string,
    parse?: ParserFunction | null
  ) {
    return this.chain<TResultNew>(query, parse);
  }
}