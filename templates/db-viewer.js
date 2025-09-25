function DBViewer({ React, app, hostAPI }) {
  const [collections, setCollections] = React.useState([]);
  const [selectedCollection, setSelectedCollection] = React.useState("");
  const [documents, setDocuments] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingData, setLoadingData] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadDocuments = React.useCallback(async (collection) => {
    try {
      setLoadingData(true);
      setError("");

      const data = await hostAPI.db.list(collection, 100);
      setDocuments(data.documents || []);
    } catch (error) {
      console.error("Failed to load documents:", error);
      setError(
        error instanceof Error ? error.message : "Failed to load documents",
      );
      setDocuments([]);
    } finally {
      setLoadingData(false);
    }
  }, []);

  const loadCollections = React.useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const collectionNames = await hostAPI.db.collections();
      const collectionsWithCounts = [];

      for (const collectionName of collectionNames) {
        try {
          const countData = await hostAPI.db.list(collectionName, 1);
          collectionsWithCounts.push({
            name: collectionName,
            count: countData.count || 0,
          });
        } catch {
          collectionsWithCounts.push({
            name: collectionName,
            count: 0,
          });
        }
      }

      setCollections(collectionsWithCounts);

      if (collectionsWithCounts.length > 0 && !selectedCollection) {
        setSelectedCollection(collectionsWithCounts[0].name);
      }
    } catch (error) {
      console.error("Failed to load collections:", error);
      setError(
        error instanceof Error ? error.message : "Failed to load collections",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCollection]);

  React.useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  React.useEffect(() => {
    if (selectedCollection) {
      loadDocuments(selectedCollection);
    }
  }, [selectedCollection, loadDocuments]);

  const formatValue = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    if (typeof value === "string" && value.length > 100) {
      return value.substring(0, 100) + "...";
    }
    return String(value);
  };

  const getColumns = () => {
    if (documents.length === 0) return [];
    const allKeys = new Set();
    documents.forEach((doc) => {
      Object.keys(doc).forEach((key) => allKeys.add(key));
      if (doc.data && typeof doc.data === "object") {
        Object.keys(doc.data).forEach((key) => allKeys.add(`data.${key}`));
      }
    });
    return Array.from(allKeys).sort();
  };

  const getValue = (doc, column) => {
    if (column.startsWith("data.")) {
      const dataKey = column.substring(5);
      return doc.data?.[dataKey];
    }
    return doc[column];
  };

  if (loading) {
    return React.createElement(
      "div",
      {
        className: "min-h-screen bg-gray-50 flex items-center justify-center",
      },
      React.createElement(
        "div",
        { className: "text-center" },
        React.createElement("div", {
          className:
            "animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600 mx-auto",
        }),
        React.createElement(
          "p",
          { className: "mt-4 text-gray-600" },
          "Loading database...",
        ),
      ),
    );
  }

  return React.createElement(
    "div",
    {
      className:
        "min-h-screen bg-gradient-to-br from-gray-100 to-gray-50 flex overflow-hidden",
    },
    React.createElement(
      "div",
      {
        className:
          "w-72 bg-white/80 backdrop-blur-md shadow-md border-r border-gray-200 flex flex-col",
      },
      React.createElement(
        "div",
        { className: "p-5 border-b border-gray-200" },
        React.createElement(
          "div",
          { className: "flex items-center mb-4" },
          React.createElement("span", { className: "text-2xl mr-2" }, "🗃️"),
          React.createElement(
            "h1",
            {
              className: "text-xl font-semibold text-gray-900 tracking-tight",
            },
            "DB Viewer",
          ),
        ),
        React.createElement(
          "button",
          {
            onClick: loadCollections,
            className:
              "w-full bg-black hover:bg-neutral-800 focus:bg-neutral-900 text-white py-2 px-4 shadow-sm transition-colors text-sm font-medium active:scale-95 focus:outline-none focus:ring-2 focus:ring-black",
          },
          React.createElement("span", { className: "mr-2" }, "🔄"),
          " Refresh",
        ),
      ),
      React.createElement(
        "div",
        { className: "flex-1 overflow-y-auto" },
        React.createElement(
          "div",
          { className: "p-4" },
          React.createElement(
            "h2",
            {
              className:
                "text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3",
            },
            `Collections (${collections.length})`,
          ),
          collections.length === 0
            ? React.createElement(
                "div",
                { className: "text-center py-8 text-gray-400" },
                React.createElement("p", null, "No collections found"),
                React.createElement(
                  "p",
                  { className: "text-xs mt-2" },
                  "Create some data first!",
                ),
              )
            : React.createElement(
                "div",
                { className: "space-y-1" },
                collections.map((collection) =>
                  React.createElement(
                    "button",
                    {
                      key: collection.name,
                      onClick: () => setSelectedCollection(collection.name),
                      className: `w-full text-left px-3 py-2 transition-colors duration-100 shadow-sm ${
                        selectedCollection === collection.name
                          ? "bg-gray-100/80 text-gray-900 border-l-4 border-gray-400"
                          : "hover:bg-gray-100/80 text-gray-700"
                      }`,
                    },
                    React.createElement(
                      "div",
                      {
                        className: "font-medium tracking-tight",
                      },
                      collection.name,
                    ),
                    React.createElement(
                      "div",
                      { className: "text-xs text-gray-500" },
                      `${collection.count} document${collection.count !== 1 ? "s" : ""}`,
                    ),
                  ),
                ),
              ),
        ),
      ),
    ),
    React.createElement(
      "div",
      { className: "flex-1 flex flex-col overflow-hidden" },
      React.createElement(
        "div",
        {
          className:
            "bg-white/80 backdrop-blur-md shadow-sm border-b border-gray-200 px-6 py-4",
        },
        React.createElement(
          "div",
          { className: "flex items-center justify-between" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "h2",
              {
                className: "text-lg font-semibold text-gray-900 tracking-tight",
              },
              selectedCollection
                ? `${selectedCollection}`
                : "Select a collection",
            ),
            selectedCollection &&
              React.createElement(
                "p",
                { className: "text-sm text-gray-500" },
                `${documents.length} document${documents.length !== 1 ? "s" : ""}`,
              ),
          ),
        ),
      ),
      React.createElement(
        "div",
        { className: "flex-1 p-8" },
        error &&
          React.createElement(
            "div",
            {
              className:
                "bg-red-50/80 border border-red-200 p-4 mb-4 shadow-sm",
            },
            React.createElement(
              "div",
              { className: "flex items-center" },
              React.createElement(
                "span",
                { className: "text-red-500 mr-2" },
                "⚠️",
              ),
              React.createElement("p", { className: "text-red-800" }, error),
            ),
          ),
        !selectedCollection
          ? React.createElement(
              "div",
              { className: "text-center py-16" },
              React.createElement("div", { className: "text-6xl mb-4" }, "📋"),
              React.createElement(
                "h3",
                {
                  className: "text-xl font-medium text-gray-900 mb-2",
                },
                "Select a Collection",
              ),
              React.createElement(
                "p",
                { className: "text-gray-500" },
                "Choose a collection from the sidebar to view its data",
              ),
            )
          : loadingData
            ? React.createElement(
                "div",
                { className: "text-center py-16" },
                React.createElement("div", {
                  className:
                    "animate-spin rounded-full h-12 w-12 border-b-2 border-gray-500 mx-auto",
                }),
                React.createElement(
                  "p",
                  { className: "mt-4 text-gray-500" },
                  "Loading data...",
                ),
              )
            : documents.length === 0
              ? React.createElement(
                  "div",
                  { className: "text-center py-16" },
                  React.createElement(
                    "div",
                    { className: "text-6xl mb-4" },
                    "📭",
                  ),
                  React.createElement(
                    "h3",
                    {
                      className: "text-xl font-medium text-gray-900 mb-2",
                    },
                    "No Data Found",
                  ),
                  React.createElement(
                    "p",
                    { className: "text-gray-500" },
                    "The selected collection is empty",
                  ),
                )
              : React.createElement(
                  "div",
                  {
                    className:
                      "bg-white/90 shadow-md border border-gray-200 overflow-hidden",
                  },
                  React.createElement(
                    "div",
                    { className: "overflow-x-auto" },
                    React.createElement(
                      "div",
                      { className: "max-h-96 overflow-y-auto" },
                      React.createElement(
                        "table",
                        { className: "w-full text-sm" },
                        React.createElement(
                          "thead",
                          {
                            className: "bg-gray-50/80 sticky top-0",
                          },
                          React.createElement(
                            "tr",
                            null,
                            getColumns().map((column) =>
                              React.createElement(
                                "th",
                                {
                                  key: column,
                                  className:
                                    "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200",
                                },
                                column,
                              ),
                            ),
                          ),
                        ),
                        React.createElement(
                          "tbody",
                          {
                            className: "bg-white/80 divide-y divide-gray-100",
                          },
                          documents.map((doc, index) =>
                            React.createElement(
                              "tr",
                              {
                                key: doc.id,
                                className:
                                  index % 2 === 0
                                    ? "bg-white/80"
                                    : "bg-gray-50/80",
                              },
                              getColumns().map((column) =>
                                React.createElement(
                                  "td",
                                  {
                                    key: column,
                                    className:
                                      "px-4 py-3 text-gray-900 max-w-xs",
                                  },
                                  React.createElement(
                                    "div",
                                    {
                                      className:
                                        "truncate text-xs bg-gray-100/60 px-2 py-1",
                                      title: formatValue(getValue(doc, column)),
                                    },
                                    formatValue(getValue(doc, column)),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
      ),
    ),
  );
}

return DBViewer;
