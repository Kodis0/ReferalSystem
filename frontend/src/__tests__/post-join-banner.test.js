/**
 * Post-join confirmation banner (pure component; no router).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PostJoinBanner } from "../pages/lk/dashboard/postJoinBanner";

const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("PostJoinBanner", () => {
  it("shows success copy for joined", async () => {
    const onDismiss = jest.fn();

    render(
      <PostJoinBanner outcome="joined" sitePublicId={SID} onDismiss={onDismiss} />
    );

    const region = screen.getByRole("status");
    expect(within(region).getByText(/Вы успешно присоединились/)).toBeInTheDocument();
    expect(within(region).getByText(/Площадка ·/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Понятно/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows already_joined copy", () => {
    render(
      <PostJoinBanner
        outcome="already_joined"
        sitePublicId={SID}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/Вы уже участвуете/)).toBeInTheDocument();
  });

  it("shows human site label when provided", () => {
    render(
      <PostJoinBanner
        outcome="joined"
        sitePublicId={SID}
        siteDisplayLabel="shop.example"
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText("shop.example")).toBeInTheDocument();
    expect(screen.queryByText(/Площадка ·/)).not.toBeInTheDocument();
  });
});
