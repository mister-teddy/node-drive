function Notepad({ React, app, hostAPI }) {
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const loadNote = async () => {
      try {
        const documents = await hostAPI.db.list("notepad_settings");
        const noteDoc = documents.documents.find(
          (doc) => doc.data.key === "note",
        );
        if (noteDoc && typeof noteDoc.data.value === "string") {
          setNote(noteDoc.data.value);
        }
      } catch (error) {
        console.error("Failed to load note:", error);
      } finally {
        setLoading(false);
      }
    };
    loadNote();
  }, []);

  const saveNote = async (value) => {
    setNote(value);
    try {
      const documents = await hostAPI.db.list("notepad_settings");
      const existingDoc = documents.documents.find(
        (doc) => doc.data.key === "note",
      );
      if (existingDoc) {
        await hostAPI.db.update("notepad_settings", existingDoc.id, {
          key: "note",
          value,
        });
      } else {
        await hostAPI.db.create("notepad_settings", { key: "note", value });
      }
    } catch (error) {
      console.error("Failed to save note:", error);
    }
  };

  return React.createElement(
    "div",
    {
      className:
        "min-h-screen bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 flex items-center justify-center font-sans",
    },
    React.createElement(
      "div",
      {
        className:
          "bg-white/90 backdrop-blur-lg shadow-2xl rounded-3xl p-10 w-full max-w-lg border border-gray-100",
      },
      React.createElement(
        "div",
        { className: "flex items-center justify-center mb-6" },
        React.createElement("span", { className: "text-3xl mr-2" }, "📝"),
        React.createElement(
          "h1",
          { className: "font-bold text-3xl tracking-tight text-gray-900" },
          "Notepad",
        ),
      ),
      React.createElement("textarea", {
        value: note,
        onChange: (e) => saveNote(e.currentTarget.value),
        rows: 1,
        style: { minHeight: "120px", maxHeight: "320px", overflow: "auto" },
        className:
          "w-full text-base font-mono bg-gray-50 border border-gray-300 rounded-2xl p-5 resize-y text-gray-900 outline-none shadow focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition",
        placeholder: loading ? "Loading..." : "Type your notes here...",
        disabled: loading,
        autoFocus: true,
      }),
      React.createElement(
        "div",
        { className: "flex justify-end mt-4" },
        React.createElement(
          "span",
          { className: "text-xs text-gray-400" },
          "Saved automatically",
        ),
      ),
    ),
  );
}

return Notepad;
