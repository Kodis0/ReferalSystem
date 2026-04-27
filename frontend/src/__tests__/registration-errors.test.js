/**
 * @jest-environment node
 */

import { formatRegistrationErrors } from "../pages/registration/registrationErrors";

describe("formatRegistrationErrors", () => {
  it("maps site_not_joinable to user-facing copy without raw status", () => {
    expect(
      formatRegistrationErrors({
        detail: "site_not_joinable",
        site_status: "draft",
      })
    ).toBe(
      "Программа по этой площадке пока недоступна для регистрации."
    );
  });

  it("maps invalid site_public_id field errors to user-facing copy", () => {
    expect(
      formatRegistrationErrors({
        site_public_id: ["Invalid site_public_id."],
      })
    ).toBe(
      "Ссылка недействительна или срок её действия истёк. Проверьте адрес или получите новую ссылку у организатора."
    );
  });

  it("translates common DRF field messages to Russian", () => {
    expect(
      formatRegistrationErrors({
        email: ["This field may not be blank."],
        password: ["This field may not be blank."],
      })
    ).toBe(
      "Email: Это поле обязательно для заполнения.\nПароль: Это поле обязательно для заполнения."
    );
  });
});
