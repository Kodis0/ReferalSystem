/**
 * Post-join confirmation banner (pure component; no router).
 *
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PostJoinBanner } from "../pages/lk/dashboard/postJoinBanner";

const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("PostJoinBanner", () => {
  it("shows success copy for joined", async () => {
    const onDismiss = jest.fn();

    render(
      <MemoryRouter>
        <PostJoinBanner outcome="joined" sitePublicId={SID} onDismiss={onDismiss} />
      </MemoryRouter>
    );

    const region = screen.getByRole("status");
    expect(within(region).getByText(/Вы подключились к агентской программе/i)).toBeInTheDocument();
    expect(within(region).getByText(/Программа ·/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Открыть программу/i })
    ).toHaveAttribute("href", `/lk/referral-program/${SID}`);
    expect(screen.getByRole("link", { name: /К агентским программам/i })).toHaveAttribute(
      "href",
      "/lk/programs"
    );

    await userEvent.click(screen.getByRole("button", { name: /Понятно/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows already_joined copy", () => {
    render(
      <MemoryRouter>
        <PostJoinBanner
          outcome="already_joined"
          sitePublicId={SID}
          onDismiss={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.getByText(/Вы уже участвуете/)).toBeInTheDocument();
  });

  it("shows human site label when provided", () => {
    render(
      <MemoryRouter>
        <PostJoinBanner
          outcome="joined"
          sitePublicId={SID}
          siteDisplayLabel="shop.example"
          onDismiss={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("shop.example")).toBeInTheDocument();
    expect(screen.queryByText(/Программа ·/)).not.toBeInTheDocument();
  });
});
