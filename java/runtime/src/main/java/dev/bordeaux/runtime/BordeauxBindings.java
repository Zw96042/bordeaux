package dev.bordeaux.runtime;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;

/** Constructs the final-round generated bindings without creating a clean-build source dependency. */
public final class BordeauxBindings {
    private static final String GENERATED_BINDINGS = "dev.bordeaux.generated.BordeauxGeneratedBindings";

    private BordeauxBindings() {}

    /**
     * Creates the generated registry from team-owned provider instances. Provider order does not matter.
     *
     * <p>The annotation processor aggregates through its final round, so a clean compilation cannot import
     * the generated class from ordinary robot source. The generated class itself still contains direct,
     * typed factory calls and the compiled catalog identity; this method only performs its fixed bootstrap.
     */
    public static BordeauxCommandRegistry generated(Object... providers) {
        Object[] available = providers == null ? new Object[0] : providers.clone();
        for (int index = 0; index < available.length; index++) {
            if (available[index] == null) {
                throw new BordeauxRuntimeException("Bordeaux command provider " + index + " must not be null");
            }
        }
        try {
            Class<?> bindingsType = Class.forName(GENERATED_BINDINGS);
            Constructor<?> constructor = generatedConstructor(bindingsType);
            Object bindings = constructor.newInstance(orderProviders(constructor.getParameterTypes(), available));
            Method registry = bindingsType.getMethod("registry");
            Object result = registry.invoke(bindings);
            if (!(result instanceof BordeauxCommandRegistry commandRegistry)) {
                throw new BordeauxRuntimeException("Generated Bordeaux bindings returned an invalid registry");
            }
            return commandRegistry;
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (ClassNotFoundException exception) {
            throw new BordeauxRuntimeException(
                    "Generated Bordeaux bindings are missing; install support and run bordeauxCatalog", exception);
        } catch (InvocationTargetException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof BordeauxRuntimeException runtimeException) throw runtimeException;
            throw new BordeauxRuntimeException("Generated Bordeaux bindings failed: " + safeMessage(cause), cause);
        } catch (ReflectiveOperationException | LinkageError exception) {
            throw new BordeauxRuntimeException(
                    "Could not initialize generated Bordeaux bindings: " + safeMessage(exception), exception);
        }
    }

    private static Constructor<?> generatedConstructor(Class<?> bindingsType) {
        Constructor<?>[] constructors = Arrays.stream(bindingsType.getConstructors())
                .filter(constructor -> Modifier.isPublic(constructor.getModifiers()))
                .toArray(Constructor<?>[]::new);
        if (constructors.length != 1) {
            throw new BordeauxRuntimeException("Generated Bordeaux bindings must expose exactly one public constructor");
        }
        return constructors[0];
    }

    private static Object[] orderProviders(Class<?>[] requiredTypes, Object[] available) {
        if (requiredTypes.length != available.length) {
            throw new BordeauxRuntimeException("Generated Bordeaux bindings require " + requiredTypes.length
                    + " provider" + (requiredTypes.length == 1 ? "" : "s") + ", but " + available.length
                    + " were supplied");
        }
        boolean[] used = new boolean[available.length];
        Object[] ordered = new Object[requiredTypes.length];
        for (int requiredIndex = 0; requiredIndex < requiredTypes.length; requiredIndex++) {
            Class<?> required = requiredTypes[requiredIndex];
            int match = matchingProvider(required, available, used, true);
            if (match < 0) match = matchingProvider(required, available, used, false);
            if (match < 0) {
                throw new BordeauxRuntimeException(
                        "Generated Bordeaux bindings require a provider of type " + required.getName());
            }
            used[match] = true;
            ordered[requiredIndex] = available[match];
        }
        return ordered;
    }

    private static int matchingProvider(Class<?> required, Object[] available, boolean[] used, boolean exact) {
        int match = -1;
        for (int candidate = 0; candidate < available.length; candidate++) {
            if (used[candidate]) continue;
            boolean matches = exact
