/**
 * @fileoverview Require useCallback for inline handlers in JSX
 * @description Prevents re-render storms from unstable function references
 */

"use strict";

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require useCallback for inline arrow function handlers in JSX",
      category: "Performance",
      recommended: true,
    },
    messages: {
      inlineHandler:
        "Inline arrow function in JSX prop '{{prop}}' creates new function on every render. Use useCallback instead.",
    },
    schema: [
      {
        type: "object",
        properties: {
          ignoredProps: {
            type: "array",
            items: { type: "string" },
            description: "Prop names to ignore (e.g., render props)",
          },
          maxInlineHandlers: {
            type: "number",
            description: "Max inline handlers before warning (0 = always warn)",
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const ignoredProps = options.ignoredProps || [
      "render",
      "renderItem",
      "children",
      "component",
    ];
    const maxInlineHandlers = options.maxInlineHandlers ?? 0;

    let inlineHandlerCount = 0;
    const handlerProps = [
      "onClick",
      "onChange",
      "onSubmit",
      "onBlur",
      "onFocus",
      "onKeyDown",
      "onKeyUp",
      "onKeyPress",
      "onMouseEnter",
      "onMouseLeave",
      "onScroll",
      "onDrag",
      "onDrop",
      "onInput",
      "onSelect",
    ];

    return {
      JSXAttribute(node) {
        // Check if this is an event handler prop.
        //
        // `node.name` is a JSXIdentifier for a plain prop (`onClick`), but a
        // JSXNamespacedName for a namespaced one (`xlink:href`, common in SVG).
        // In the namespaced case `node.name.name` is undefined, so propName is
        // an object — truthy, but with no .startsWith — and the guard below
        // used to throw "propName.startsWith is not a function", which ESLint
        // surfaces as a rule crash that aborts the whole lint run rather than
        // as a lint error. Constrain to strings so a non-identifier prop is
        // simply not a handler.
        const propName =
          typeof node.name.name === "string" ? node.name.name : null;

        if (propName === null) {
          return;
        }

        // Skip ignored props
        if (ignoredProps.includes(propName)) {
          return;
        }

        // Check if it's a handler prop (on* pattern).
        //
        // The length check is load-bearing: a two-character prop named exactly
        // `on` passes startsWith("on"), and then propName[2] is undefined and
        // .toUpperCase() throws — another crash-the-lint-run failure. An `on`
        // prop is not an on<Event> handler, so require a third character.
        const isHandlerProp =
          handlerProps.includes(propName) ||
          (propName.startsWith("on") &&
            propName.length > 2 &&
            propName[2] === propName[2].toUpperCase());

        if (!isHandlerProp) {
          return;
        }

        // Check if the value is an inline function. Arrow and function
        // expressions both allocate a new function on every render, so both
        // defeat memoisation — treat them the same.
        if (
          node.value &&
          node.value.type === "JSXExpressionContainer" &&
          (node.value.expression.type === "ArrowFunctionExpression" ||
            node.value.expression.type === "FunctionExpression")
        ) {
          inlineHandlerCount++;

          if (inlineHandlerCount > maxInlineHandlers) {
            context.report({
              node,
              messageId: "inlineHandler",
              data: { prop: propName },
            });
          }
        }
      },

      "Program:exit"() {
        // Reset counter for next file
        inlineHandlerCount = 0;
      },
    };
  },
};
