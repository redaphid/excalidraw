import { Center } from "./WelcomeScreen.Center";

import "./WelcomeScreen.scss";

const WelcomeScreen = (props: { children?: React.ReactNode }) => {
  return (
    <>
      {props.children || <Center />}
    </>
  );
};

WelcomeScreen.displayName = "WelcomeScreen";

WelcomeScreen.Center = Center;

export default WelcomeScreen;
