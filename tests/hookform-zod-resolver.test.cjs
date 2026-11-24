const test = require("node:test");
const assert = require("node:assert/strict");

// Guard the resolver contract used by GroupFeaturesPanel's poll and event
// forms: @hookform/resolvers must surface Zod 4 validation issues as
// react-hook-form field errors instead of throwing. The schema below mirrors
// the shape of those forms with synthetic input.
test("zod resolver reports Zod 4 field errors instead of throwing", async () => {
  const { zodResolver } = require("@hookform/resolvers/zod");
  const { z } = require("zod");

  const schema = z.object({
    question: z.string().trim().min(3, "Enter a question with at least 3 characters").max(240),
    options: z
      .array(z.object({ value: z.string().trim().min(1, "Enter an option").max(100) }))
      .min(2, "Add at least two options")
      .max(10),
    multiple: z.boolean(),
  });

  const resolver = zodResolver(schema);
  const resolverOptions = {
    fields: {},
    shouldUseNativeValidation: false,
    criteriaMode: "firstError",
  };

  const invalid = await resolver(
    { question: "ab", options: [{ value: "" }, { value: "" }], multiple: false },
    {},
    resolverOptions
  );

  assert.deepEqual(invalid.values, {});
  assert.equal(invalid.errors.question.type, "too_small");
  assert.equal(invalid.errors.question.message, "Enter a question with at least 3 characters");
  assert.equal(invalid.errors.options[0].value.message, "Enter an option");
  assert.equal(invalid.errors.options[1].value.message, "Enter an option");

  const valid = await resolver(
    { question: "  Which day works?  ", options: [{ value: " Monday " }, { value: "Tuesday" }], multiple: true },
    {},
    resolverOptions
  );

  assert.deepEqual(valid.errors, {});
  assert.deepEqual(valid.values, {
    question: "Which day works?",
    options: [{ value: "Monday" }, { value: "Tuesday" }],
    multiple: true,
  });
});
