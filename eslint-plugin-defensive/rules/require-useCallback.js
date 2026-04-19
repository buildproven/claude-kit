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
        // Check if this is an event handler prop
        const propName = node.name.name;

        // Skip ignored props
        if (ignoredProps.includes(propName)) {
          return;
        }

        // Check if it's a handler prop (on* pattern)
        const isHandlerProp =
          handlerProps.includes(propName) ||
          (propName &&
            propName.startsWith("on") &&
            propName[2] === propName[2].toUpperCase());

        if (!isHandlerProp) {
          return;
        }

        // Check if the value is an inline arrow function
        if (
          node.value &&
          node.value.type === "JSXExpressionContainer" &&
          node.value.expression.type === "ArrowFunctionExpression"
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
