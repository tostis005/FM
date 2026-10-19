import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines, ArrowUp, CircleHelp, Clock3, Database, Mic, MessageCircle,
  Plus, RotateCcw, ShieldCheck, Sparkles, Square, Trash2, X
} from "lucide-react";
import "./AsistenteDemo.css";
import { collectSpeechResults, mergeDictationDraft } from "./dictadoVoz.js";

const SUGGESTIONS = [
  { icon: Database, text: "¿Qué productos tienen más stock inmovilizado?" },
  { icon: AudioLines, text: "¿Por qué ha bajado mi margen este mes?" },
  { icon: Clock3, text: "¿Qué artículos se están vendiendo más despacio?" },
  { icon: CircleHelp, text: "¿Dónde puedo encontrar oportunidades de ahorro?" }
];

function demoReply(question) {
  const q = question.toLocaleLowerCase("es-ES");
  if (/stock|inmoviliz|sobrestock|existencias/.test(q))
    return "Cuando conectemos los datos, analizaré las existencias, la rotación y las ventas por farmacia para identificar el stock inmovilizado. Esta versión es una maqueta: todavía no tiene cifras reales.";
  if (/margen|rentab|beneficio|pvp|precio/.test(q))
    return "Podré comparar precios de venta, costes de compra, unidades y evolución del margen para explicarte las diferencias. Por ahora no hay consultas ni resultados reales conectados.";
  if (/venta|rotaci|artículo|producto|genéric/.test(q))
    return "El asistente podrá cruzar ventas, productos, periodos y farmacias, con las mismas definiciones que los informes. Esta conversación solo demuestra cómo funcionará la interfaz.";
  if (/compra|proveedor|ahorro|descuento/.test(q))
    return "Al integrar la capa analítica podré comparar costes de compra, proveedores y oportunidades de ahorro entre las farmacias autorizadas. De momento no se consultan datos.";
  return "He recibido tu pregunta. Esta es la vista previa del asistente de Farmétrica: cuando conectemos el modelo y las herramientas analíticas, podré investigar los datos autorizados y responder con resultados contrastables.";
}

function stamp() {
  return new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function timerLabel(seconds) {
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

export default function AsistenteDemo({ section = "Dashboard" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [dictationStatus, setDictationStatus] = useState("idle");
  const [dictationPreview, setDictationPreview] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [audioError, setAudioError] = useState("");
  const [transcriptionReady, setTranscriptionReady] = useState(false);
  const [sessionNumber, setSessionNumber] = useState(1);
  const inputRef = useRef(null);
  const conversationRef = useRef(null);
  const dialogRef = useRef(null);
  const launcherRef = useRef(null);
  const recognitionRef = useRef(null);
  const dictationTokenRef = useRef(0);
  const recognizedRef = useRef({ final: "", interim: "" });
  const baseDraftRef = useRef("");
  const speechErroredRef = useRef(false);
  const tickerRef = useRef(null);
  const durationRef = useRef(0);
  const counterRef = useRef(0);
  const isDictating = dictationStatus !== "idle";

  function createMessage(role, text) {
    counterRef.current += 1;
    return { id: counterRef.current, role, text, time: stamp() };
  }

  function clearTicker() {
    if (tickerRef.current) window.clearInterval(tickerRef.current);
    tickerRef.current = null;
  }

  function cancelDictation() {
    dictationTokenRef.current += 1; // Ignorar resultados tardíos al descartar, cerrar o cambiar de conversación.
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    clearTicker();
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try { recognition.abort(); } catch {}
    }
    setDictationStatus("idle");
    setDictationPreview("");
    setSeconds(0);
  }

  function completeDictation(token) {
    if (token !== dictationTokenRef.current) return;
    clearTicker();
    recognitionRef.current = null;
    dictationTokenRef.current += 1;
    setDictationStatus("idle");
    setDictationPreview("");
    const spoken = [recognizedRef.current.final, recognizedRef.current.interim].filter(Boolean).join(" ").trim();
    if (spoken) {
      // El dictado añade texto al borrador existente sin enviarlo automáticamente.
      setDraft(mergeDictationDraft(baseDraftRef.current, spoken));
      setTranscriptionReady(true);
      setAudioError("");
      inputRef.current?.focus();
    } else if (!speechErroredRef.current) {
      setAudioError("No se ha detectado una frase. Vuelve a intentarlo o escribe tu pregunta.");
    }
  }

  function stopDictation() {
    const recognition = recognitionRef.current;
    if (!recognition || dictationStatus === "finishing") return;
    setDictationStatus("finishing");
    clearTicker();
    try { recognition.stop(); }
    catch { completeDictation(dictationTokenRef.current); }
  }

  function startDictation() {
    if (isDictating) return;
    setAudioError("");
    setTranscriptionReady(false);
    const BrowserRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!BrowserRecognition) {
      setAudioError("Este navegador no permite transcribir voz directamente. Puedes escribir tu pregunta; el dictado local se incorporará al conectar el servicio de transcripción.");
      return;
    }
    let recognition;
    try {
      recognition = new BrowserRecognition();
      recognition.lang = "es-ES";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
    } catch {
      setAudioError("No se ha podido iniciar el reconocimiento de voz en este navegador.");
      return;
    }
    const token = ++dictationTokenRef.current;
    recognitionRef.current = recognition;
    recognizedRef.current = { final: "", interim: "" };
    baseDraftRef.current = draft;
    speechErroredRef.current = false;
    durationRef.current = 0;
    setSeconds(0);
    setDictationPreview("");
    setDictationStatus("starting");
    recognition.onstart = () => {
      if (token !== dictationTokenRef.current) return;
      setDictationStatus("listening");
      tickerRef.current = window.setInterval(() => {
        durationRef.current += 1;
        setSeconds(durationRef.current);
        if (durationRef.current >= 120) {
          clearTicker();
          try { recognition.stop(); } catch { completeDictation(token); }
          setDictationStatus("finishing");
        }
      }, 1000);
    };
    recognition.onresult = event => {
      if (token !== dictationTokenRef.current) return;
      recognizedRef.current = collectSpeechResults(event.results);
      setDictationPreview([recognizedRef.current.final, recognizedRef.current.interim].filter(Boolean).join(" "));
    };
    recognition.onerror = event => {
      if (token !== dictationTokenRef.current) return;
      speechErroredRef.current = true;
      const messages = {
        "not-allowed": "Debes permitir el acceso al micrófono para dictar.",
        "service-not-allowed": "El navegador ha bloqueado el reconocimiento de voz.",
        "audio-capture": "No se ha encontrado un micrófono disponible.",
        "no-speech": "No se ha detectado voz. Vuelve a intentarlo.",
        network: "El servicio de reconocimiento de voz del navegador no está disponible.",
        "language-not-supported": "El navegador no admite reconocimiento de voz en español."
      };
      setAudioError(messages[event.error] || "No ha sido posible transcribir el audio. Inténtalo de nuevo.");
    };
    recognition.onend = () => completeDictation(token);
    try { recognition.start(); }
    catch {
      recognitionRef.current = null;
      dictationTokenRef.current += 1;
      setDictationStatus("idle");
      setAudioError("No se ha podido activar el micrófono. Comprueba sus permisos.");
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelDictation();
        setOpen(false);
        launcherRef.current?.focus();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll("button:not(:disabled),textarea:not(:disabled)")];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [messages, open]);

  useEffect(() => () => {
    dictationTokenRef.current += 1;
    clearTicker();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try { recognition.abort(); } catch {}
    }
  }, []);

  function closeAssistant() {
    cancelDictation();
    setOpen(false);
    launcherRef.current?.focus();
  }

  function sendText(text = draft) {
    const question = text.trim();
    if (!question || isDictating) return;
    setMessages(previous => [
      ...previous,
      createMessage("user", question),
      createMessage("assistant", demoReply(question))
    ]);
    setDraft("");
    setAudioError("");
    setTranscriptionReady(false);
    inputRef.current?.focus();
  }

  function newConversation() {
    cancelDictation();
    setMessages([]);
    setDraft("");
    setAudioError("");
    setTranscriptionReady(false);
    setSessionNumber(value => value + 1);
    inputRef.current?.focus();
  }

  return (
    <>
      <button
        ref={launcherRef}
        className="fm-ai-launcher"
        type="button"
        aria-label="Abrir asistente de Farmétrica (demo)"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Sparkles size={23} aria-hidden="true" />
        <span className="fm-ai-launcher-label">Asistente IA</span>
      </button>
      {open && (
        <div className="fm-ai-root">
          <section className="fm-ai-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="fm-ai-title">
            <aside className="fm-ai-rail" aria-label="Opciones del asistente">
              <div className="fm-ai-rail-brand"><span className="fm-ai-logo"><Sparkles size={23}/></span><span>Farmétrica <strong>IA</strong></span></div>
              <button type="button" className="fm-ai-new" onClick={newConversation}><Plus size={17}/> Nueva conversación</button>
              <div className="fm-ai-rail-label">ESTÁS CONSULTANDO</div>
              <div className="fm-ai-rail-context"><Database size={17}/><span>{section}</span></div>
              <div className="fm-ai-rail-label">PRUEBA ESTAS PREGUNTAS</div>
              <div className="fm-ai-rail-prompts">
                {SUGGESTIONS.map(item => (
                  <button key={item.text} type="button" onClick={() => sendText(item.text)} disabled={isDictating}>
                    <item.icon size={16} aria-hidden="true"/><span>{item.text}</span>
                  </button>
                ))}
              </div>
              <div className="fm-ai-rail-footer"><ShieldCheck size={16}/><span>Versión demo: sin acceso a los datos ni motor de IA conectado.</span></div>
            </aside>
            <div className="fm-ai-workspace">
              <header className="fm-ai-topbar">
                <div className="fm-ai-heading">
                  <div className="fm-ai-heading-icon"><Sparkles size={19}/></div>
                  <div><h1 id="fm-ai-title">Asistente Farmétrica</h1><p>Tu espacio de análisis en lenguaje natural</p></div>
                </div>
                <div className="fm-ai-top-actions">
                  <span className="fm-ai-demo-status"><span/> Modo demo</span>
                  <button type="button" className="fm-ai-icon-btn fm-ai-mobile-new" title="Nueva conversación" aria-label="Nueva conversación" onClick={newConversation}><RotateCcw size={19}/></button>
                  <button type="button" className="fm-ai-icon-btn" aria-label="Cerrar asistente" title="Cerrar asistente" onClick={closeAssistant}><X size={22}/></button>
                </div>
              </header>
              <div className="fm-ai-messages" ref={conversationRef} aria-label="Conversación" aria-live="polite" aria-relevant="additions text">
                {messages.length === 0 ? (
                  <div className="fm-ai-welcome">
                    <div className="fm-ai-welcome-symbol"><Sparkles size={28}/></div>
                    <div className="fm-ai-welcome-kicker">ASISTENTE FARMÉTRICA</div>
                    <h2>¿Qué te gustaría analizar?</h2>
                    <p>Pregunta sobre ventas, compras, márgenes o stock. Prueba también a dictar una pregunta con el micrófono.</p>
                    <div className="fm-ai-suggestion-grid">
                      {SUGGESTIONS.map(item => (
                        <button type="button" key={item.text} onClick={() => sendText(item.text)}>
                          <item.icon size={18} aria-hidden="true"/><span>{item.text}</span><ArrowUp size={14} className="fm-ai-suggestion-arrow"/>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="fm-ai-thread" key={sessionNumber}>
                    {messages.map(message => (
                      <div key={message.id} className={"fm-ai-msg fm-ai-msg-" + message.role}>
                        <div className="fm-ai-msg-avatar">{message.role === "assistant" ? <Sparkles size={16}/> : "TÚ"}</div>
                        <div className="fm-ai-msg-content">
                          <div className="fm-ai-msg-bubble">
                            <p>{message.text}</p>
                            
                          </div>
                          <time className="fm-ai-msg-time">{message.time}{message.role === "assistant" ? " · Respuesta de demostración" : ""}</time>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="fm-ai-bottom">
                {audioError && <div className="fm-ai-error" role="alert">{audioError}</div>}
                {isDictating && <section className="fm-ai-dictation" aria-label="Dictado de voz">
                  <div className="fm-ai-dictation-content">
                    <div className="fm-ai-dictation-icon"><Mic size={25}/></div>
                    <div className="fm-ai-dictation-copy">
                      <strong>{dictationStatus === "starting" ? "Preparando micrófono…" : dictationStatus === "finishing" ? "Terminando el dictado…" : "Te escucho"}</strong>
                      <span aria-live="polite">{dictationPreview || (dictationStatus === "finishing" ? "Pasando el dictado a texto" : "Habla de forma natural. Tu pregunta aparecerá aquí mientras la dictas.")}</span>
                    </div>
                    <div className="fm-ai-dictation-timer">{timerLabel(seconds)}</div>
                  </div>
                  <div className="fm-ai-dictation-actions">
                    <button type="button" className="fm-ai-dictation-discard" onClick={cancelDictation}>
                      <Trash2 size={21}/> <span>Descartar</span>
                    </button>
                    <button type="button" className="fm-ai-dictation-stop" onClick={stopDictation} disabled={dictationStatus === "finishing"}>
                      <Square size={19} fill="currentColor"/> <span>{dictationStatus === "finishing" ? "Transcribiendo…" : "Detener y transcribir"}</span>
                    </button>
                  </div>
                </section>}
                {transcriptionReady && !isDictating && <p className="fm-ai-transcription-ready" role="status">Transcripción lista: revísala o edítala antes de enviarla.</p>}
                <div className="fm-ai-composer">
                  <textarea
                    ref={inputRef}
                    aria-label="Escribe tu pregunta"
                    placeholder={isDictating ? "Termina el dictado para continuar..." : "Escribe una pregunta sobre tus farmacias..."}
                    rows={2}
                    maxLength={2000}
                    disabled={isDictating}
                    value={draft}
                    onChange={event => { setDraft(event.target.value); setTranscriptionReady(false); }}
                    onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendText(); } }}
                  />
                  <div className="fm-ai-composer-actions">
                    <span>Intro para enviar · Mayús + Intro para nueva línea</span>
                    <div>
                      <button type="button" className="fm-ai-icon-btn" title="Dictar una pregunta" aria-label="Dictar una pregunta" disabled={isDictating} onClick={startDictation}><Mic size={19}/></button>
                      <button type="button" className="fm-ai-send" disabled={!draft.trim() || isDictating} aria-label="Enviar mensaje" title="Enviar mensaje" onClick={() => sendText()}><ArrowUp size={19}/></button>
                    </div>
                  </div>
                </div>
                <p className="fm-ai-disclaimer"><MessageCircle size={13}/> Modo demo: el chat no consulta datos. El dictado utiliza el reconocimiento del navegador, que puede procesar la voz en un servicio externo según el dispositivo.</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
