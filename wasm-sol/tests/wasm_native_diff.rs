//! Ported from the verifier of P3c (`p3c-verify/tests/v_diff.rs`). Replays the cases of
//! `tools/diff_cases.cjs` (answers of the release WASM build on truncated and mutated inputs)
//! through the native build. Every answer must be equal, and none may be a trap. The cases are
//! written by the wasm build: after each wasm build (`sh build.sh`), run
//! `node tools/diff_cases.cjs target/pkg-node` in this folder.

use p3_check::wasm::check_message;

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn the_wasm_answers_equal_the_native_answers_on_mutated_inputs() {
    let path = format!("{}/logs/diffcases/cases.json", env!("CARGO_MANIFEST_DIR"));
    let bytes = std::fs::read(path)
        .expect("run node tools/diff_cases.cjs target/pkg-node first (see the README)");
    let cases: Vec<serde_json::Value> =
        serde_json::from_slice(&bytes).expect("cases.json is not valid JSON");
    assert!(cases.len() > 3000, "{} cases", cases.len());
    let now = 1_800_000_000u64 - 3_600;
    let mut different = Vec::new();
    for (n, case) in cases.iter().enumerate() {
        let field = |k: &str| unhex(case[k].as_str().unwrap());
        let got = check_message(&field("m"), &field("i"), &field("p"), &field("s"), now);
        if got != case["a"].as_str().unwrap() {
            different.push(n);
        }
    }
    assert!(
        different.is_empty(),
        "{} of {} differ: {:?}",
        different.len(),
        cases.len(),
        different
    );
}
