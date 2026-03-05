import { useEffect, useRef, useState } from "react";
import { toast, ToastContainer } from "react-toastify";
import { io } from "socket.io-client";

const socket = io("https://rummy-backend.vercel.app/");

// ================= TYPES =================

interface Player {
  id: string;
  name: string;
  hand: string[];
}

interface RoomUpdate {
  players: Player[];
  hostId: string;
}

interface GameState {
  players: Player[];
  hostId: string;
  currentPlayerId: string;
  openCard: string;
  deckCount: number;
  gameStarted: boolean;
}

interface RummyRequest {
  cards: string[];
}

interface CardPosition {
  x: number;
  y: number;
}

interface DragState {
  active: boolean;
  card: string | null;
  pointerId: number | null;
  offsetX: number;
  offsetY: number;
  cardW: number;
  cardH: number;
  moved: boolean;
  startClientX: number;
  startClientY: number;
}

function App() {
  const playAreaRef = useRef<HTMLDivElement | null>(null);

  const [cardPositions, setCardPositions] = useState<
    Record<string, CardPosition>
  >({});

  const dragRef = useRef<DragState>({
    active: false,
    card: null,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
    cardW: 0,
    cardH: 0,
    moved: false,
    startClientX: 0,
    startClientY: 0,
  });

  const rafRef = useRef<number | null>(null);

  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const ignoreClickRef = useRef<boolean>(false);

  const getDefaultPos = (i: number): CardPosition => ({
    x: 10 + i * 60,
    y: 10,
  });

  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));

  const updateCardPositionFromClient = (clientX: number, clientY: number) => {
    const playEl = playAreaRef.current;
    if (!playEl) return;

    const playRect = playEl.getBoundingClientRect();
    const d = dragRef.current;

    const left = clientX - playRect.left - d.offsetX;
    const top = clientY - playRect.top - d.offsetY;
    const bottom = playRect.height - top - d.cardH;

    const x = clamp(left, 0, Math.max(0, playRect.width - d.cardW));
    const y = clamp(bottom, 0, Math.max(0, playRect.height - d.cardH));

    const cardKey = d.card;
    if (!cardKey) return;

    setCardPositions((prev) => ({
      ...prev,
      [cardKey]: { x, y },
    }));
  };

  // ================= DRAG EVENTS =================

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;

      const d = dragRef.current;

      if (!d.moved) {
        const dx = Math.abs(e.clientX - d.startClientX);
        const dy = Math.abs(e.clientY - d.startClientY);
        if (dx + dy > 3) d.moved = true;
      }

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        updateCardPositionFromClient(e.clientX, e.clientY);
      });
    };

    const endDrag = () => {
      if (!dragRef.current.active) return;

      const moved = dragRef.current.moved;

      dragRef.current.active = false;
      dragRef.current.card = null;
      dragRef.current.pointerId = null;
      dragRef.current.moved = false;

      setDraggingCard(null);

      if (moved) {
        ignoreClickRef.current = true;
        window.setTimeout(() => {
          ignoreClickRef.current = false;
        }, 0);
      }
    };

    window.addEventListener("pointermove", onPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ================= GAME STATE =================

  const [name, setName] = useState<string>("");
  const [joined, setJoined] = useState<boolean>(false);

  const [_players, setPlayers] = useState<Player[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);

  const [hand, setHand] = useState<string[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);

  const [openCard, setOpenCard] = useState<string | null>(null);
  const [_deckCount, setDeckCount] = useState<number>(0);

  const [gameStarted, setGameStarted] = useState<boolean>(false);
  const [rummyRequest, setRummyRequest] = useState<RummyRequest | null>(null);
  const [joker, setJoker] = useState<string | null>(null);

  const isMyTurn = socket.id === currentPlayerId;
  const isHost = socket.id === hostId;

  // ================= SOCKET EVENTS =================

  useEffect(() => {
    socket.on("roomUpdate", (data: RoomUpdate) => {
      setPlayers(data.players);
      setHostId(data.hostId);
    });

    socket.on("serverRestarted", () => {
      toast.info("Server Restarted");

      setJoined(false);
      setGameStarted(false);
      setPlayers([]);
      setHand([]);
      setJoker(null);
      setSelectedCards([]);
      setRummyRequest(null);
      setCardPositions({});
    });

    socket.on("gameState", (data: GameState) => {
      setPlayers(data.players);
      setHostId(data.hostId);
      setCurrentPlayerId(data.currentPlayerId);
      setOpenCard(data.openCard);
      setDeckCount(data.deckCount);
      setGameStarted(data.gameStarted);

      const me = data.players.find((p) => p.id === socket.id);
      if (me) setHand(me.hand);
    });

    socket.on("rummyRequest", (data: RummyRequest) => {
      setRummyRequest(data);
    });

    socket.on("showJoker", (card: string) => {
      setJoker(card);
      toast.success("Suspense Joker Revealed!" + card);
    });

    socket.on("rummyApproved", () => {
      toast.success("Rummy Approved!");
      setRummyRequest(null);
    });

    socket.on("rummyRejected", () => {
      toast.error("Rummy Rejected!");

      setRummyRequest(null);
    });

    socket.on("gameCompleted", (data: { winner: string }) => {
      toast.success("Game Completed! Winner: " + data.winner);
      setGameStarted(false);
      setJoker(null);
    });

    socket.on("error", (err: string) => toast.error(err));

    return () => {
      socket.off("roomUpdate");
      socket.off("gameState");
      socket.off("rummyRequest");
      socket.off("showJoker");
      socket.off("rummyApproved");
      socket.off("rummyRejected");
      socket.off("gameCompleted");
      socket.off("error");
    };
  }, []);

  // ================= ACTIONS =================

  const joinGame = () => {
    if (!name.trim()) return toast.error("Enter unique name");
    localStorage.setItem("playerName", name);
    socket.emit("joinGame", { name });
    setJoined(true);
  };

  const startGame = () => socket.emit("startGame");
  const drawFromDeck = () => socket.emit("drawCard", { from: "deck" });
  const pickOpenCard = () => socket.emit("drawCard", { from: "open" });
  const dropCard = (card: string) => socket.emit("dropCard", { card });

  const showRummy = () => {
    if (selectedCards.length !== 3)
      return toast.error("Select exactly 3 cards");

    socket.emit("showRummy", { cards: selectedCards });
    setSelectedCards([]);
  };

  const respondRummy = (approve: boolean) => {
    socket.emit("verifyRummy", { approve });
    setRummyRequest(null);
  };

  const completeGame = () => socket.emit("completeGame");

  const toggleSelectCard = (card: string) => {
    if (!isMyTurn) return;
    if (hand.length !== 14) return;

    if (selectedCards.includes(card)) {
      setSelectedCards(selectedCards.filter((c) => c !== card));
    } else {
      if (selectedCards.length >= 3) return toast.error("Only 3 cards allowed");
      setSelectedCards([...selectedCards, card]);
    }
  };

  // ================= UI =================
  if (!joined) {
    return (
      <div style={styles.container}>
        {/* <h2>Join Rummy Game</h2> */}
        <div style={styles.startingArea}>
          <input
            placeholder="Enter Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
          />
          <button onClick={joinGame} style={styles.button}>
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.playContainer}>
        <div style={styles.dragZone} ref={playAreaRef}>
          {hand.map((card, i) => {
            const position = cardPositions[card];
            const isDraggingThis = draggingCard === card;
            const fallback = getDefaultPos(i);
            return (
              <div
                key={i}
                onPointerDown={(e) => {
                  // Only left click for mouse; always allow touch/pen.
                  if (e.pointerType === "mouse" && e.button !== 0) return;
                  const playEl = playAreaRef.current;
                  if (!playEl) return;

                  e.preventDefault();

                  const cardEl = e.currentTarget;
                  const cardRect = cardEl.getBoundingClientRect();
                  const offsetX = e.clientX - cardRect.left;
                  const offsetY = e.clientY - cardRect.top;

                  dragRef.current.active = true;
                  dragRef.current.card = card;
                  dragRef.current.pointerId = e.pointerId;
                  dragRef.current.offsetX = offsetX;
                  dragRef.current.offsetY = offsetY;
                  dragRef.current.cardW = cardRect.width;
                  dragRef.current.cardH = cardRect.height;
                  dragRef.current.moved = false;
                  dragRef.current.startClientX = e.clientX;
                  dragRef.current.startClientY = e.clientY;

                  setDraggingCard(card);
                  updateCardPositionFromClient(e.clientX, e.clientY);

                  // Keep receiving pointer events even if cursor leaves card.
                  try {
                    cardEl.setPointerCapture(e.pointerId);
                  } catch {
                    // ignore
                  }
                }}
                onClick={() => {
                  if (ignoreClickRef.current) return;
                  toggleSelectCard(card);
                }}
                onDoubleClick={() => {
                  if (!isMyTurn) return;
                  if (hand.length !== 14) return toast.error("Draw first");
                  dropCard(card);
                }}
                style={{
                  ...styles.card,
                  position: "absolute",
                  left: position ? position.x : fallback.x,
                  bottom: position ? position.y : fallback.y,
                  border: selectedCards.includes(card)
                    ? "1px solid yellow"
                    : "1px solid black",
                  cursor: isDraggingThis ? "grabbing" : "grab",
                  userSelect: "none",
                  touchAction: "none",
                  willChange: "left, bottom",
                  transition: isDraggingThis
                    ? "none"
                    : "left 80ms linear, bottom 80ms linear",
                }}
              >
                {card}
              </div>
            );
          })}
        </div>
        <div style={styles.infoZone}>
          {!gameStarted && (
            <div style={styles.startContainer}>
              <input
                placeholder="Enter Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={styles.input}
              />
              <button onClick={joinGame} style={styles.button}>
                Join
              </button>
              {isHost && (
                <button style={styles.startButton} onClick={startGame}>
                  Start
                </button>
              )}
            </div>
          )}

          {gameStarted && (
            <div style={styles.startContainer}>
              {isMyTurn ? "🔥" : "Waiting..."}
              {joker && <h6 style={{ color: "#3BADCA" }}> {joker}</h6>}
              <div style={{ display: "flex", gap: 5 }}>
                <button
                  onClick={drawFromDeck}
                  disabled={!isMyTurn}
                  style={styles.deck}
                >
                  🂠
                </button>

                <button
                  style={styles.card}
                  onClick={pickOpenCard}
                  disabled={!isMyTurn}
                >
                  {openCard}
                </button>
              </div>
              {isMyTurn && (
                <div style={{ display: "flex", gap: 5 }}>
                  <button onClick={showRummy} style={styles.startButton}>
                    Rummy
                  </button>

                  {joker && (
                    <button onClick={completeGame} style={styles.startButton}>
                      Complete
                    </button>
                  )}
                </div>
              )}

              {rummyRequest && (
                <div>
                  <div>
                    {rummyRequest.cards.map((card, i) => (
                      <span key={i} style={styles.previewCard}>
                        {card}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => respondRummy(true)}
                    style={styles.startButton}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => respondRummy(false)}
                    style={styles.button}
                  >
                    No
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <button onClick={() => socket.emit("restartServer")}>Restart</button>
      <ToastContainer />
    </div>
  );
}

export default App;

// ================= STYLES =================
const styles: any = {
  container: {
    width: "100%",
    height: "100vh",
    overflow: "hidden",
  },
  playContainer: {
    position: "relative",
    height: "200px",
    display: "flex",
    gap: "20px",
  },
  dragZone: {
    // background: "green",
    flex: 1,
  },
  infoZone: {
    // background: "green",
    width: "200px",
    position: "relative",
  },
  startContainer: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  },
  input: { padding: 5 },

  center: { textAlign: "center", marginTop: 20 },

  button: { padding: 8, margin: 5, cursor: "pointer" },
  startButton: {
    padding: 10,
    margin: 10,
    // backgroundColor: "green",
    // color: "white",
    cursor: "pointer",
  },
  deck: {
    display: "inline-block",
    padding: 10,
    borderRadius: 5,
    minWidth: 30,
    fontSize: 18,
  },
  openCard: { marginTop: 20 },
  card: {
    display: "inline-block",
    padding: 10,
    borderRadius: 5,
    minWidth: 30,
    fontSize: 18,
    color: "gray",
  },
  smallButton: { padding: 5, marginTop: 5 },
  hand: { marginTop: 20 },
  players: { marginBottom: 20 },
  rummyBox: {
    marginTop: 20,
    background: "#f1f1f1",
    padding: 15,
  },
  previewCard: {
    padding: 10,
    margin: 5,
    border: "1px solid black",
    display: "inline-block",
    color: "gray",
  },
  playArea: {
    width: "100%",
    height: "200px",

    // backgroundColor: "#0b6623",
    // overflow: "hidden",
  },
  other: {
    width: "500px",
    height: "500px",
    right: 100,
    // backgroundColor: "#0b6623",
  },
};
