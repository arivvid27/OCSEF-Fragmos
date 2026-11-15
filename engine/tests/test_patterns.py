"""One hit and one near miss for every pattern ported from Fragmos's lib/patterns.ts and lib/entropy.ts. Every value
is fake."""

from pathlib import Path

import pytest
import yaml

from sentinel.core.policy import load_policy

POLICY = load_policy(yaml.safe_load((Path(__file__).parent.parent / "policy.yaml").read_text()))
RANDOM = "q7Zp2LmX9vB4nR8tK1wY6cD3"  # 24 characters, no head any pattern knows


@pytest.fixture(scope="module")
def found(presidio):
    return lambda text: {(s.entity_type, text[s.start:s.end]) for s in presidio.scan(text, frozenset(POLICY.tiers))}


def types_of(spans):
    return {t for t, _ in spans}


# Hits are low-entropy on purpose, so only the pattern named can explain them: (text, value, near miss).
SECRETS = {
    "openai-project": ("deploy with sk-proj-aaaa1111 today", "sk-proj-aaaa1111", "the sk-proj-x1 stub"),
    "openai-legacy": ("use sk-aaaaaaaaaa1111111111 now", "sk-aaaaaaaaaa1111111111", "the sk-cube-grid class"),
    "aws-temporary-access-key": ("id ASIAIOSFODNN7EXAMPLE here", "ASIAIOSFODNN7EXAMPLE", "id ASIAIOSFODNN7EXAMPL here"),
    "aws-secret-assignment": ("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                              "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
                              "rotate the aws_secret_access_key every 90 days"),
    "github-fine-grained": ("github_pat_aaaa1111 expires soon", "github_pat_aaaa1111", "the github_pat_ prefix"),
    "slack": ("xoxb-1111111111-aaaaaaaaaa in the env", "xoxb-1111111111-aaaaaaaaaa", "xoxo-1111111111 love"),
    "stripe": ("rk_live_aaaa1111 in config", "rk_live_aaaa1111", "sk_prod_aaaa1111 in config"),
    "google-aiza": ("AIzaaaaaaaaa11111111 in config", "AIzaaaaaaaaa11111111", "AIzaaaaa1111 is too short"),
    "google-aq": ("AQ.aaaaaaaaaaaaaaa111111111111111 in config", "AQ.aaaaaaaaaaaaaaa111111111111111",
                  "AQ.aaaaaaaaaaaaaaa1111 is too short"),
    "sendgrid": ("SG.aaaaaaaaaaa11111111111 in config", "SG.aaaaaaaaaaa11111111111", "SG.2026.report is out"),
    "twilio": (f"sid AC{'0' * 16}{'a' * 16} ok", f"AC{'0' * 16}{'a' * 16}", f"sid AC{'0' * 16}{'a' * 15} ok"),
    "npm": ("npm_aaaaaaaa11111111 in .npmrc", "npm_aaaaaaaa11111111", "npm_config_registry is set"),
    "pgp-private-key": ("-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBGExampleOnlyNotReal\n"
                        "-----END PGP PRIVATE KEY BLOCK-----", "lQOYBGExampleOnlyNotReal",
                        "the line -----BEGIN PGP PRIVATE KEY BLOCK----- opens the file"),
    "bearer": ("Authorization: bearer aaaaaaaaaaaa11111111", "bearer aaaaaaaaaaaa11111111", "the bearer of bad news"),
    "basic-auth": ("Authorization: Basic YWFhYWFhYWFhYWFhMTEx", "Basic YWFhYWFhYWFhYWFhMTEx",
                   "Basic training starts Monday"),
    "url-credentials": ("postgres://admin:S3cretPass99@db.internal:5432/students", "admin:S3cretPass99@db.internal",
                        "postgres://db.internal:5432/students"),
    "assignment": ("SMTP_PASSWORD=hunter2hunter2", "SMTP_PASSWORD=hunter2hunter2", "the password policy is strict"),
    "assignment-json": ('"api_key": "abc123xyz"', 'api_key": "abc123xyz', '"api_key": null'),
    "entropy-alone": (f"paste {RANDOM} into the form", RANDOM, f"paste {RANDOM[:18]} into the form"),
    "entropy-after-a-key-word": (f"the token is {RANDOM[:18]}", RANDOM[:18], "the token is aaaaaaaaaaaaaaaa1111"),
}


@pytest.mark.parametrize("text, value, near_miss", SECRETS.values(), ids=SECRETS)
def test_a_secret_pattern_hits_and_its_near_miss_does_not(found, text, value, near_miss):
    assert any(t == "SECRET" and value in v for t, v in found(text)), found(text)
    assert "SECRET" not in types_of(found(near_miss)), found(near_miss)


@pytest.mark.parametrize("text", [
    "tokens like [PERSON_1] or [EMAIL_ADDRESS_2] or [PROJECT_CODENAME_12] stand for the api key",
    "tool call toolu_01A09q90qw90lq917835lq9 returned after the auth token expired",
    "tool call call_e18a2dd95d5840dba2d9eb17 returned after the auth token expired",
    "the reply msg_9e310bca73174afebd7c1141fdd5e0f9 used the api key",
    "set AWS_SECRET_ACCESS_KEY_2 and STRIPE_WEBHOOK_SECRET_V2 in the api settings",
    "https://www.example.com/2026/11/14/technology/ai-agents-privacy-proxy.html",
    "https://api.example.com/repos/owner/repository-name-2/issues",
], ids=["placeholders", "anthropic-tool-id", "deepseek-tool-id", "message-id", "constant-names", "dated-url",
        "api-url"])
def test_entropy_reads_no_secret_into_ids_names_and_urls(found, text):
    assert "SECRET" not in types_of(found(text)), found(text)


def test_entropy_still_reads_a_token_in_a_url_query(found):
    url = f"https://api.example.com/v2/export?session={RANDOM}"
    assert ("SECRET", f"session={RANDOM}") in found(url)
