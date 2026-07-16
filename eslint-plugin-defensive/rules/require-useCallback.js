/**
 * @fileoverview Require useCallback for inline functions in JSX handlers
 * @description Prevents re-render storms from unstable function references
 */

"use strict";

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require useCallback for inline function handlers in JSX",
      category: "Performance",
      recommended: true,
    },
    messages: {
      inlineHandler:
        "Inline function in JSX prop '{{prop}}' creates a new function on every render. Use useCallback instead.",
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
        // Check if this is an event handler prop
        const propName =
          typeof node.name.name === "string" ? node.name.name : null;

        // Skip ignored props
        if (ignoredProps.includes(propName)) {
          return;
        }

        // Check if it's a handler prop (on* pattern)
        const isHandlerProp =
          handlerProps.includes(propName) ||
          (propName &&
            propName.length > 2 &&
            propName.startsWith("on") &&
            propName[2] === propName[2].toUpperCase());

        if (!isHandlerProp) {
          return;
        }

        // Check if the value is an inline function
        if (
          node.value &&
          node.value.type === "JSXExpressionContainer" &&
          ["ArrowFunctionExpression", "FunctionExpression"].includes(
            node.value.expression.type,
          )
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
