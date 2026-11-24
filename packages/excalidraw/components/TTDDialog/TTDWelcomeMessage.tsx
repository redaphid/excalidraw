export const TTDWelcomeMessage = () => {
  return (
    <div className="chat-interface__welcome-screen__welcome-message">
      <h3>{"Let's design your diagram"}</h3>
      <p>
        {
          "Describe the diagram you want to create, and we'll generate it for you."
        }
      </p>
      <p>
        {
          "At the moment we know Flowchart, Sequence, Class, State, and Entity Relationship diagrams."
        }
      </p>
    </div>
  );
};
