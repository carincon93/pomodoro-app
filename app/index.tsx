import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppState, StatusBar, View } from "react-native";
import Rive, {
  Alignment,
  AutoBind,
  Fit,
  useRive,
  useRiveString,
  useRiveTrigger,
} from "rive-react-native";

const STORAGE_KEY = "countdown_state";
const WORK_DURATION_IN_SEC = Math.floor(45 * 60); // ejemplo corto
const BREAK_DURATION_IN_SEC = Math.floor(15 * 60); // ejemplo corto
const MODE_SWITCH_DELAY_MS = 700; // delay para suavizar cambios (ajusta a tu gusto)

const initialState = {
  start: false,
  isWorking: false,
  remainingTime: 0,
  stop: false,
};

// Acciones
type Action =
  | { type: "PLAY" }
  | { type: "STOP" }
  | { type: "SET_MODE"; payload: { isWorking: boolean; remainingTime: number } }
  | { type: "RESTORE_TIMER"; payload: number }
  | { type: "TICK" };

function timerReducer(state: typeof initialState, action: Action) {
  switch (action.type) {
    case "PLAY":
      return {
        ...state,
        start: true,
        stop: false,
        isWorking: true, // siempre empezar en WORK en el primer play
        remainingTime: WORK_DURATION_IN_SEC,
      };

    case "STOP":
      return {
        ...state,
        start: false,
        stop: true,
        isWorking: false,
        remainingTime: 0,
      };

    case "SET_MODE":
      return {
        ...state,
        isWorking: action.payload.isWorking,
        remainingTime: action.payload.remainingTime,
      };

    case "RESTORE_TIMER":
      return { ...state, remainingTime: action.payload };

    case "TICK":
      return { ...state, remainingTime: Math.max(state.remainingTime - 1, 0) };

    default:
      return state;
  }
}

export default function HomeScreen() {
  const [setRiveRef, riveRef] = useRive();
  const [state, dispatch] = useReducer(timerReducer, initialState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const switchingRef = useRef(false); // evita reentrada cuando estamos cambiando de modo

  const { start, isWorking, remainingTime, stop } = state;

  const [, setWorkMinutes] = useRiveString(riveRef, "workMinutes");
  const [, setWorkSeconds] = useRiveString(riveRef, "workSeconds");
  const [, setBreakMinutes] = useRiveString(riveRef, "breakMinutes");
  const [, setBreakSeconds] = useRiveString(riveRef, "breakSeconds");

  // Play trigger: dispatch PLAY, persist mode WORK, arrancar ciclo
  useRiveTrigger(riveRef, "triggPlay", async () => {
    dispatch({ type: "PLAY" });
    // guarda inmediatamente el timestamp con modo WORK (pasado explícitamente)
    await saveStartTime(true);
    // restoreTimer se lanzará desde el effect de start (ve más abajo)
  });

  // Stop trigger
  useRiveTrigger(riveRef, "triggStop", async () => {
    // limpiar storage y detener
    await AsyncStorage.removeItem(STORAGE_KEY);
    if (intervalRef.current) clearInterval(intervalRef.current);
    dispatch({ type: "STOP" });
    changeAnimation(false);
  });

  // Guarda startTimestamp y duration; recibe modo explícito para evitar closures
  const saveStartTime = useCallback(async (modeIsWorking: boolean) => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      const startTimestamp = Date.now();
      const duration = modeIsWorking
        ? WORK_DURATION_IN_SEC
        : BREAK_DURATION_IN_SEC;
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ startTimestamp, duration })
      );
      // console.log("Saved STORAGE_KEY:", { startTimestamp, duration });
    } catch (err) {
      console.warn("saveStartTime error", err);
    }
  }, []);

  // Restaura remainingTime desde storage (si existe)
  const restoreTimer = useCallback(async () => {
    if (!start) return;
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        const { startTimestamp, duration } = JSON.parse(data);
        const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
        const remaining = Math.max(duration - elapsed, 0);
        dispatch({ type: "RESTORE_TIMER", payload: remaining });
        // console.log("restoreTimer -> restored remaining:", remaining);
      } else {
        // No storage: inicializa según el modo actual (state.isWorking)
        const duration = isWorking
          ? WORK_DURATION_IN_SEC
          : BREAK_DURATION_IN_SEC;
        dispatch({ type: "RESTORE_TIMER", payload: duration });
        // console.log("restoreTimer -> no storage, set remaining to", duration);
      }
    } catch (err) {
      console.warn("restoreTimer error", err);
    }
  }, [start, isWorking]);

  const changeAnimation = useCallback(
    (showBreakAnimation: boolean) => {
      if (!riveRef) return;

      riveRef.setInputState("State Machine 1", "break", showBreakAnimation);
    },
    [riveRef]
  );

  // effect: controla el intervalo cuando start && !stop
  useEffect(() => {
    if (!start || stop) return;

    let mounted = true;

    const run = async () => {
      // restaura antes de arrancar el intervalo
      await restoreTimer();

      if (!mounted) return;

      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        dispatch({ type: "TICK" });
      }, 1000);
    };

    run();

    return () => {
      mounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // dependencias claras
  }, [start, stop, restoreTimer]);

  // effect: cuando remainingTime llega a 0 -> cambiar modo según isWorking actual
  useEffect(() => {
    // si no está corriendo el ciclo, ignorar
    if (!start || stop) return;

    // si aún hay tiempo, nada que hacer
    if (remainingTime > 0) return;

    // previene reentrada mientras cambiamos
    if (switchingRef.current) return;

    // sincronizamos: detenemos intervalo y hacemos la transición con pequeño delay
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    switchingRef.current = true;
    const nextModeIsWorking = !isWorking; // si estaba en work -> next is break

    // console.log(
    //   "⏳ remainingTime reached 0 => switching mode to",
    //   nextModeIsWorking ? "WORK" : "BREAK"
    // );

    changeAnimation(!nextModeIsWorking);

    const timeoutId = setTimeout(async () => {
      // guardamos el nuevo inicio en storage con el modo destino
      await saveStartTime(nextModeIsWorking);

      // actualizamos el estado con el nuevo modo y duración correspondiente
      const nextDuration = nextModeIsWorking
        ? WORK_DURATION_IN_SEC
        : BREAK_DURATION_IN_SEC;
      dispatch({
        type: "SET_MODE",
        payload: { isWorking: nextModeIsWorking, remainingTime: nextDuration },
      });

      // damos pequeña pausa y luego arrancamos el intervalo de nuevo
      setTimeout(() => {
        if (start && !stop) {
          // arrancará el effect de start porque state.start sigue true
          // para forzar immediate restore (opcional) podemos llamar restoreTimer()
          // pero ya guardamos y seteamos remainingTime directamente así que arrancará desde ahí.
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = setInterval(() => {
            dispatch({ type: "TICK" });
          }, 1000);
        }
        switchingRef.current = false;
      }, 200); // pequeña pausa antes de reanudar
    }, MODE_SWITCH_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
      switchingRef.current = false;
    };
  }, [remainingTime, start, stop, isWorking, saveStartTime, changeAnimation]);

  // efecto: actualiza valores de Rive (min / sec) cada vez que cambie remainingTime o isWorking
  useEffect(() => {
    if (!riveRef) return;

    const mins = Math.floor(remainingTime / 60);
    const secs = remainingTime % 60;

    if (isWorking) {
      setWorkMinutes(String(mins).padStart(2, "0"));
      setWorkSeconds(String(secs).padStart(2, "0"));
    } else {
      setBreakMinutes(String(mins).padStart(2, "0"));
      setBreakSeconds(String(secs).padStart(2, "0"));
    }
  }, [
    riveRef,
    remainingTime,
    isWorking,
    setWorkMinutes,
    setWorkSeconds,
    setBreakMinutes,
    setBreakSeconds,
  ]);

  // // logs útiles
  // useEffect(() => {
  //   console.log("STATE:", { start, isWorking, remainingTime, stop });
  // }, [start, isWorking, remainingTime, stop]);

  // 🔹 Detecta cuando la app vuelve del background
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // Recalcular tiempo restante al volver al foreground
        restoreTimer();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [restoreTimer]);

  useEffect(() => {
    const keepAwake = async () => {
      if (start && !stop) {
        await activateKeepAwakeAsync();
      } else {
        deactivateKeepAwake();
      }
    };

    keepAwake();
  }, [start, stop]);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar
        backgroundColor="transparent"
        translucent
        barStyle="light-content"
      />
      <Rive
        ref={setRiveRef}
        artboardName="Pomodoro"
        resourceName="pomodoro"
        stateMachineName="State Machine 1"
        autoplay={true}
        dataBinding={AutoBind(true)}
        style={{ width: "100%", height: "100%" }}
        fit={Fit.Cover}
        alignment={Alignment.Center}
      />
    </View>
  );
}
