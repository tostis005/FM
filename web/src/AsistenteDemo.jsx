import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines, ArrowUp, Check, CircleHelp, Clock3, Database, Mic, MessageCircle,
  Plus, RotateCcw, ShieldCheck, Sparkles, Square, Trash2, X
} from "lucide-react";
import "./AsistenteDemo.css";

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
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [recorded, setRecorded] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [audioError, setAudioError] = useState("");
  const [sessionNumber, setSessionNumber] = useState(1);
  const inputRef = useRef(null);
  const conversationRef = useRef(null);
  const dialogRef = useRef(null);
  const launcherRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const tickerRef = useRef(null);
  const durationRef = useRef(0);
  const discardRef = useRef(false);
  const requestRef = useRef(0);
  const createdUrlsRef = useRef(new Set());
  const counterRef = useRef(0);

  function createMessage(role, text, audioUrl) {
    counterRef.current += 1;
    return { id: counterRef.current, role, text, audioUrl: audioUrl || null, time: stamp() };
  }

  function revokeUrl(url) {
    if (url && createdUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      createdUrlsRef.current.delete(url);
    }
  }

  function clearTicker() {
    if (tickerRef.current) window.clearInterval(tickerRef.current);
    tickerRef.current = null;
  }

  function stopTracks() {
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }

  function finishRecording(discard = false) {
    requestRef.current += 1;
    discardRef.current = discard;
    clearTicker();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { stopTracks(); }
    } else {
      stopTracks();
    }
    setRecording(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finishRecording(true);
        setRequesting(false);
        setOpen(false);
        launcherRef.current?.focus();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll("button:not(:disabled),textarea:not(:disabled),audio[controls]")];
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
    requestRef.current += 1;
    clearTicker();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      try { recorderRef.current.stop(); } catch {}
    }
    stopTracks();
    createdUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    createdUrlsRef.current.clear();
  }, []);

  function closeAssistant() {
    finishRecording(true);
    setRequesting(false);
    setOpen(false);
    launcherRef.current?.focus();
  }

  function sendText(text = draft) {
    const question = text.trim();
    if (!question || recording || requesting) return;
    setMessages(previous => [
      ...previous,
      createMessage("user", question),
      createMessage("assistant", demoReply(question))
    ]);
    setDraft("");
    setAudioError("");
    inputRef.current?.focus();
  }

  async function startRecording() {
    if (recording || requesting) return;
    setAudioError("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setAudioError("Este navegador no permite grabar audio aquí. Comprueba que utilizas HTTPS y que el micrófono está disponible.");
      return;
    }
    if (recorded) { revokeUrl(recorded.url); setRecorded(null); }
    const currentRequest = ++requestRef.current;
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (currentRequest !== requestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(value => MediaRecorder.isTypeSupported(value));
      const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      const chunks = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      discardRef.current = false;
      recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => setAudioError("Se ha interrumpido la grabación. Inténtalo de nuevo.");
      recorder.onstop = () => {
        stopTracks();
        recorderRef.current = null;
        if (discardRef.current) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) { setAudioError("No se ha registrado audio. Vuelve a intentarlo."); return; }
        const url = URL.createObjectURL(blob);
        createdUrlsRef.current.add(url);
        setRecorded({ url, size: blob.size });
      };
      recorder.start();
      setRequesting(false);
      durationRef.current = 0;
      setSeconds(0);
      setRecording(true);
      tickerRef.current = window.setInterval(() => {
        durationRef.current += 1;
        setSeconds(durationRef.current);
        if (durationRef.current >= 120) finishRecording(false);
      }, 1000);
    } catch (error) {
      if (currentRequest !== requestRef.current) return;
      setRequesting(false);
      stopTracks();
      setRecording(false);
      setAudioError(error?.name === "NotAllowedError"
        ? "Permite el acceso al micrófono en tu navegador para grabar una pregunta."
        : "No se ha podido abrir el micrófono. Comprueba el dispositivo y vuelve a intentarlo.");
    }
  }

  function removeAudio() {
    if (recorded) revokeUrl(recorded.url);
    setRecorded(null);
    setSeconds(0);
  }

  function sendAudio() {
    if (!recorded || recording) return;
    setMessages(previous => [
      ...previous,
      createMessage("user", "Mensaje de voz · " + timerLabel(seconds), recorded.url),
      createMessage("assistant", "Audio recibido en la maqueta. Puedes reproducirlo en esta conversación. No se ha enviado a ningún servidor: la transcripción y la respuesta por IA se conectarán en una fase posterior.")
    ]);
    setRecorded(null);
    setSeconds(0);
    setAudioError("");
  }

  function newConversation() {
    finishRecording(true);
    setRequesting(false);
    if (recorded) revokeUrl(recorded.url);
    createdUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    createdUrlsRef.current.clear();
    setRecorded(null);
    setMessages([]);
    setDraft("");
    setAudioError("");
    setSeconds(0);
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
                  <button key={item.text} type="button" onClick={() => sendText(item.text)}>
                    <item.icon size={16} aria-hidden="true"/><span>{item.text}</span>
                  </button>
                ))}
              </div>
              <div className="fm-ai-rail-footer"><ShieldCheck size={16}/><span>Maqueta local. Sin acceso a los datos ni a servicios de IA.</span></div>
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
                            {message.audioUrl && <audio controls preload="none" src={message.audioUrl} aria-label="Reproducir mensaje de voz"/>}
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
                {requesting && <div className="fm-ai-recording" role="status"><span className="fm-ai-rec-dot"/> Solicitando permiso del micrófono… <button type="button" onClick={() => { finishRecording(true); setRequesting(false); }}>Cancelar</button></div>}
                {recording && <div className="fm-ai-recording" role="status">
                  <span className="fm-ai-rec-dot"/><span>Grabando audio</span><strong>{timerLabel(seconds)}</strong>
                  <button type="button" onClick={() => finishRecording(true)} title="Descartar grabación"><Trash2 size={16}/> Descartar</button>
                  <button type="button" onClick={() => finishRecording(false)} className="fm-ai-stop"><Square size={14} fill="currentColor"/> Detener</button>
                </div>}
                {recorded && <div className="fm-ai-audio-preview">
                  <AudioLines size={19}/><span>Audio listo · {timerLabel(seconds)}</span>
                  <audio controls preload="none" src={recorded.url} aria-label="Escuchar grabación antes de enviar"/>
                  <button type="button" className="fm-ai-icon-btn" onClick={removeAudio} aria-label="Eliminar audio"><X size={18}/></button>
                  <button type="button" className="fm-ai-send-audio" onClick={sendAudio}><Check size={16}/> Enviar audio</button>
                </div>}
                <div className="fm-ai-composer">
                  <textarea
                    ref={inputRef}
                    aria-label="Escribe tu pregunta"
                    placeholder={recording || requesting ? "Termina la grabación para escribir..." : "Escribe una pregunta sobre tus farmacias..."}
                    rows={2}
                    maxLength={2000}
                    disabled={recording || requesting}
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendText(); } }}
                  />
                  <div className="fm-ai-composer-actions">
                    <span>Intro para enviar · Mayús + Intro para nueva línea</span>
                    <div>
                      <button type="button" className="fm-ai-icon-btn" title="Grabar mensaje de voz" aria-label="Grabar mensaje de voz" disabled={recording || requesting || Boolean(recorded)} onClick={startRecording}><Mic size={19}/></button>
                      <button type="button" className="fm-ai-send" disabled={!draft.trim() || recording || requesting} aria-label="Enviar mensaje" title="Enviar mensaje" onClick={() => sendText()}><ArrowUp size={19}/></button>
                    </div>
                  </div>
                </div>
                <p className="fm-ai-disclaimer"><MessageCircle size={13}/> Vista previa: los mensajes y audios permanecen en esta pestaña y no se envían a Farmétrica ni a servicios externos.</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
