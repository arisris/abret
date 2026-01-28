import { describe, expect, test } from "bun:test";
import {
  clearContext,
  createContext,
  hasContext,
  runWithContext,
  runWithContextValue,
  setContext,
  useContext,
} from "../src/store";

// Define test contexts
const UserContext = createContext<{ id: string; name: string }>("user");
const SessionContext = createContext<string>("session");
const CounterContext = createContext<number>("counter");

// Context with default value
const ThemeContext = createContext("theme", "light");

describe("abret/store", () => {
  describe("createContext", () => {
    test("creates unique context symbols", () => {
      const Context1 = createContext<string>("test");
      const Context2 = createContext<string>("test");

      // Same name but different symbols
      expect(Context1).not.toBe(Context2);
      expect(typeof Context1).toBe("symbol");
      expect(typeof Context2).toBe("symbol");
    });

    test("context has description", () => {
      const TestContext = createContext<string>("myContext");
      expect(TestContext.description).toBe("myContext");
    });

    test("creates context with default value and Provider", () => {
      const ctx = createContext("defaultTest", "default-value");

      expect(ctx.defaultValue).toBe("default-value");
      expect(typeof ctx.Provider).toBe("function");
      expect(typeof ctx.id).toBe("symbol");
    });
  });

  describe("setContext & useContext", () => {
    test("sets and gets context value", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "123", name: "John" });
        const user = useContext(UserContext);
        expect(user).toEqual({ id: "123", name: "John" });
      });
    });

    test("returns undefined for missing context", () => {
      runWithContext(() => {
        const user = useContext(UserContext);
        expect(user).toBeUndefined();
      });
    });

    test("throws when required context is missing", () => {
      runWithContext(() => {
        expect(() => useContext(UserContext, { required: true })).toThrow(
          'Context "user" is required but not set',
        );
      });
    });

    test("returns value when required context exists", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "456", name: "Jane" });
        const user = useContext(UserContext, { required: true });
        expect(user).toEqual({ id: "456", name: "Jane" });
      });
    });

    test("context is isolated per runWithContext call", async () => {
      const results: (string | undefined)[] = [];

      await Promise.all([
        new Promise<void>((resolve) => {
          runWithContext(() => {
            setContext(SessionContext, "session-1");
            setTimeout(() => {
              results.push(useContext(SessionContext));
              resolve();
            }, 10);
          });
        }),
        new Promise<void>((resolve) => {
          runWithContext(() => {
            setContext(SessionContext, "session-2");
            setTimeout(() => {
              results.push(useContext(SessionContext));
              resolve();
            }, 5);
          });
        }),
      ]);

      expect(results.sort()).toEqual(["session-1", "session-2"]);
    });

    test("multiple contexts in same scope", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "123", name: "John" });
        setContext(SessionContext, "session-abc");
        setContext(CounterContext, 42);

        expect(useContext(UserContext)).toEqual({ id: "123", name: "John" });
        expect(useContext(SessionContext)).toBe("session-abc");
        expect(useContext(CounterContext)).toBe(42);
      });
    });

    test("context can be updated", () => {
      runWithContext(() => {
        setContext(CounterContext, 1);
        expect(useContext(CounterContext)).toBe(1);

        setContext(CounterContext, 2);
        expect(useContext(CounterContext)).toBe(2);
      });
    });

    test("context with default value returns default when not set", () => {
      runWithContext(() => {
        const theme = useContext(ThemeContext);
        expect(theme).toBe("light");
      });
    });

    test("context with default value returns set value when set", () => {
      runWithContext(() => {
        setContext(ThemeContext, "dark");
        const theme = useContext(ThemeContext);
        expect(theme).toBe("dark");
      });
    });
  });

  describe("hasContext", () => {
    test("returns true when context is set", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "123", name: "John" });
        expect(hasContext(UserContext)).toBe(true);
      });
    });

    test("returns false when context is not set", () => {
      runWithContext(() => {
        expect(hasContext(UserContext)).toBe(false);
      });
    });

    test("returns false for different context", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "123", name: "John" });
        expect(hasContext(SessionContext)).toBe(false);
      });
    });
  });

  describe("clearContext", () => {
    test("clears specific context", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "123", name: "John" });
        setContext(SessionContext, "session-abc");

        clearContext(UserContext);

        expect(useContext(UserContext)).toBeUndefined();
        expect(useContext(SessionContext)).toBe("session-abc");
      });
    });

    test("does nothing when context not set", () => {
      runWithContext(() => {
        // Should not throw
        clearContext(UserContext);
        expect(useContext(UserContext)).toBeUndefined();
      });
    });
  });

  describe("runWithContext", () => {
    test("creates isolated context scope", () => {
      const result = runWithContext(() => {
        setContext(CounterContext, 42);
        return useContext(CounterContext);
      });

      expect(result).toBe(42);
    });

    test("nested scopes inherit parent context", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "1", name: "Outer" });

        runWithContext(() => {
          // Inner scope inherits from outer
          expect(useContext(UserContext)).toEqual({ id: "1", name: "Outer" });
        });
      });
    });

    test("nested scope changes don't affect parent", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "1", name: "Outer" });

        runWithContext(() => {
          setContext(UserContext, { id: "2", name: "Inner" });
          expect(useContext(UserContext)).toEqual({ id: "2", name: "Inner" });
        });

        // Parent still has original value
        expect(useContext(UserContext)).toEqual({ id: "1", name: "Outer" });
      });
    });
  });

  describe("runWithContextValue", () => {
    test("runs function with context value", () => {
      const result = runWithContextValue(ThemeContext, "dark", () => {
        return useContext(ThemeContext);
      });

      expect(result).toBe("dark");
    });

    test("supports nested context values", () => {
      const result = runWithContextValue(ThemeContext, "dark", () => {
        return runWithContextValue(
          UserContext,
          { id: "1", name: "John" },
          () => {
            const theme = useContext(ThemeContext);
            const user = useContext(UserContext);
            return `${theme}-${user?.name}`;
          },
        );
      });

      expect(result).toBe("dark-John");
    });

    test("inner context overrides outer for same context", () => {
      const result = runWithContextValue(ThemeContext, "dark", () => {
        return runWithContextValue(ThemeContext, "blue", () => {
          return useContext(ThemeContext);
        });
      });

      expect(result).toBe("blue");
    });

    test("outer context is restored after inner exits", () => {
      const results: string[] = [];

      runWithContextValue(ThemeContext, "dark", () => {
        results.push(useContext(ThemeContext));

        runWithContextValue(ThemeContext, "blue", () => {
          results.push(useContext(ThemeContext));
        });

        results.push(useContext(ThemeContext));
      });

      expect(results).toEqual(["dark", "blue", "dark"]);
    });
  });

  describe("error handling", () => {
    test("setContext throws when called outside context scope", () => {
      expect(() => setContext(UserContext, { id: "1", name: "Test" })).toThrow(
        "setContext must be called within a context scope",
      );
    });

    test("useContext returns undefined when called outside context scope", () => {
      const result = useContext(UserContext);
      expect(result).toBeUndefined();
    });

    test("useContext with default returns default outside context scope", () => {
      const result = useContext(ThemeContext);
      expect(result).toBe("light");
    });
  });

  describe("type safety", () => {
    test("context value type is preserved", () => {
      runWithContext(() => {
        setContext(CounterContext, 42);
        const count = useContext(CounterContext);
        if (count !== undefined) {
          const doubled: number = count * 2;
          expect(doubled).toBe(84);
        }
      });
    });

    test("required context returns non-nullable type", () => {
      runWithContext(() => {
        setContext(UserContext, { id: "123", name: "John" });
        const user = useContext(UserContext, { required: true });
        expect(user.name).toBe("John");
      });
    });

    test("context with default value returns non-undefined type", () => {
      runWithContext(() => {
        const theme = useContext(ThemeContext);
        // TypeScript knows theme is string (not undefined)
        expect(theme.toUpperCase()).toBe("LIGHT");
      });
    });
  });

  describe("async context propagation", () => {
    test("context propagates through async functions", async () => {
      const result = await runWithContext(async () => {
        setContext(UserContext, { id: "async", name: "AsyncUser" });

        // Simulate async operation
        await new Promise((r) => setTimeout(r, 10));

        return useContext(UserContext);
      });

      expect(result).toEqual({ id: "async", name: "AsyncUser" });
    });

    test("isolated contexts for concurrent async operations", async () => {
      const results = await Promise.all([
        runWithContext(async () => {
          setContext(CounterContext, 1);
          await new Promise((r) => setTimeout(r, 10));
          return useContext(CounterContext);
        }),
        runWithContext(async () => {
          setContext(CounterContext, 2);
          await new Promise((r) => setTimeout(r, 5));
          return useContext(CounterContext);
        }),
      ]);

      expect(results).toEqual([1, 2]);
    });
  });
});
