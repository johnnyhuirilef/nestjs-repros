# A fallback that shares the LanguageModel of an earlier model is dropped with no warning

In `@nestjs/ai` 0.0.2, a call drops a fallback model from its chain when the fallback uses the same `LanguageModel` object as a model before it. This happens, for example, when an app keeps one provider model in a constant and gives it to two models with different settings, such as a "patient" model with a longer timeout. The call fails without trying the fallback, and no warning is logged.

The script runs two cases. In each case, the model `default` fails with a 503 and has `fallback: 'patient'`. The control gives `default` and `patient` two different `LanguageModel` objects. The other case gives them the same object. The script records the warnings that Nest's logger receives.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
"default" fails with a 503 and has fallback: "patient".

Two LanguageModel objects (control)          answered "from patient" from "patient", 2 model call(s), 1 warning(s)
  warn: The model "default" failed (APICallError, 503: The provider answered 503); falling back to "patient".
One LanguageModel object for both            rejected (AiModelError), 1 model call(s), 0 warning(s)

RESULT: BUG: the fallback "patient" is dropped with no warning when it shares the LanguageModel of "default".
```

The exit code is 1. When the bug is fixed, the script prints `RESULT: FIXED` and exits with 0.
